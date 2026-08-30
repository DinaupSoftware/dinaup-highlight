import { rules, CodeLang } from './rules';

/** Un tramo de texto que recibe un formato. */
export interface Hit {
    start: number;
    end: number;
    format: string;
}

/** Cómo se lee cada tramo del documento: como código de un lenguaje, o como marcado. */
type ZoneMode = CodeLang | 'html';

interface Zone {
    start: number;
    end: number;
    mode: ZoneMode;
}

/** Perfil léxico de un lenguaje: qué abre un comentario y qué abre una cadena. */
interface LexProfile {
    lineComment: string[];
    blockComment: [string, string] | null;
    /** Comillas que abren cadena. El cierre es el mismo carácter. */
    quotes: string[];
    /** La barra invertida escapa dentro de las cadenas (VB no: dobla la comilla). */
    backslashEscape: boolean;
    /** Prefijos que preceden a una comilla sin cambiar el cierre: @"", $"", u8"". */
    stringPrefixes: string[];
}

const LEX: Record<CodeLang, LexProfile> = {
    vb: { lineComment: ["'"], blockComment: null, quotes: ['"'], backslashEscape: false, stringPrefixes: [] },
    cs: { lineComment: ['//'], blockComment: ['/*', '*/'], quotes: ['"', "'"], backslashEscape: true, stringPrefixes: ['@', '$'] },
    js: { lineComment: ['//'], blockComment: ['/*', '*/'], quotes: ['"', "'", '`'], backslashEscape: true, stringPrefixes: [] },
};

const IDENT_START = /[\p{L}_$]/u;
const IDENT_PART = /[\p{L}\p{N}_$]/u;
const UPPER = /\p{Lu}/u;
const LOWER = /\p{Ll}/u;
const LETTER = /\p{L}/u;
const DIGIT = /[0-9]/;

interface Token {
    text: string;
    start: number;
    end: number;
    isNumber: boolean;
}

/** Un tramo de cadena o de comentario, con sus límites reales en el documento. */
interface Trivia {
    start: number;
    end: number;
    /** Cadena con partes que son código: $"..{x}.." de C#, `..${x}..` de JS. */
    interpolated: boolean;
}

interface Lexed {
    tokens: Token[];
    strings: Trivia[];
    comments: Trivia[];
}

// ── Tokenización ─────────────────────────────────────────────────────────────

/**
 * Recorre un tramo de código y devuelve sus identificadores y números,
 * saltando comentarios y cadenas.
 */
function tokenize(text: string, from: number, to: number, lang: CodeLang): Lexed {
    const lex = LEX[lang];
    const tokens: Token[] = [];
    const strings: Trivia[] = [];
    const comments: Trivia[] = [];
    let i = from;
    // Último carácter con significado: distingue la división del literal de expresión regular
    let lastSignificant = '';

    while (i < to) {
        const ch = text[i];

        // Comentario de línea
        const line = lex.lineComment.find(marker => text.startsWith(marker, i));
        if (line !== undefined) {
            const nl = text.indexOf('\n', i);
            const end = nl === -1 || nl > to ? to : nl;
            comments.push({ start: i, end, interpolated: false });
            i = end + 1;
            continue;
        }

        // REM de Visual Basic: sólo cuenta al principio de una palabra
        if (lang === 'vb' && (ch === 'R' || ch === 'r') && /^rem\b/i.test(text.slice(i, i + 4))) {
            const nl = text.indexOf('\n', i);
            const end = nl === -1 || nl > to ? to : nl;
            comments.push({ start: i, end, interpolated: false });
            i = end + 1;
            continue;
        }

        // Comentario de bloque
        if (lex.blockComment !== null && text.startsWith(lex.blockComment[0], i)) {
            const close = text.indexOf(lex.blockComment[1], i + 2);
            const end = close === -1 || close > to ? to : close + lex.blockComment[1].length;
            comments.push({ start: i, end, interpolated: false });
            i = end;
            continue;
        }

        // Expresión regular de JavaScript: sin esto, una comilla dentro de /.../ descuadra el resto
        if (lang === 'js' && ch === '/' && startsRegex(lastSignificant)) {
            i = skipRegex(text, i, to);
            lastSignificant = '/';
            continue;
        }

        // Cadena, con o sin prefijo (@"", $"", $@"")
        let quoteAt = i;
        while (quoteAt < to && lex.stringPrefixes.includes(text[quoteAt])) {
            quoteAt++;
        }
        if (quoteAt < to && lex.quotes.includes(text[quoteAt])) {
            const quote = text[quoteAt];
            const start = i;
            i = skipString(text, quoteAt, to, quote, lex.backslashEscape && text[i] !== '@');
            const interpolated = text.slice(start, quoteAt).includes('$') || quote === '`';
            strings.push({ start, end: i, interpolated });
            lastSignificant = quote;
            continue;
        }

        // Número
        if (DIGIT.test(ch)) {
            const start = i;
            while (i < to && /[0-9a-fA-FxXoObB._]/.test(text[i])) {
                i++;
            }
            // Un punto final pertenece al acceso a miembro, no al número: 1.ToString()
            while (i > start + 1 && text[i - 1] === '.') {
                i--;
            }
            tokens.push({ text: text.slice(start, i), start, end: i, isNumber: true });
            lastSignificant = text[i - 1];
            continue;
        }

        // Identificador
        if (IDENT_START.test(ch)) {
            const start = i;
            while (i < to && IDENT_PART.test(text[i])) {
                i++;
            }
            tokens.push({ text: text.slice(start, i), start, end: i, isNumber: false });
            lastSignificant = text[i - 1];
            continue;
        }

        if (/\s/.test(ch) === false) {
            lastSignificant = ch;
        }
        i++;
    }

    return { tokens, strings, comments };
}

/**
 * Una barra abre expresión regular cuando lo anterior no puede cerrar un valor.
 * Tras `)`, `]`, un identificador o un número, la barra es una división.
 */
function startsRegex(lastSignificant: string): boolean {
    if (lastSignificant === '') {
        return true;
    }
    return '=(,:[!&|?{};+-*%~^<>'.includes(lastSignificant);
}

/** Salta `/.../flags`. Si la barra resulta ser una división, avanza un solo carácter. */
function skipRegex(text: string, open: number, to: number): number {
    let i = open + 1;
    let inClass = false;

    while (i < to) {
        const ch = text[i];
        if (ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === '\n') {
            return open + 1;
        }
        if (ch === '[') {
            inClass = true;
        } else if (ch === ']') {
            inClass = false;
        } else if (ch === '/' && inClass === false) {
            i++;
            while (i < to && IDENT_PART.test(text[i])) {
                i++;
            }
            return i;
        }
        i++;
    }
    return open + 1;
}

/** Devuelve la posición justo después de la cadena que abre en `open`. */
function skipString(text: string, open: number, to: number, quote: string, backslashEscape: boolean): number {
    let i = open + 1;
    while (i < to) {
        const ch = text[i];
        if (backslashEscape && ch === '\\') {
            i += 2;
            continue;
        }
        if (ch === quote) {
            // Comilla doblada: sigue dentro de la cadena (VB, y las verbatim de C#)
            if (backslashEscape === false && text[i + 1] === quote) {
                i += 2;
                continue;
            }
            return i + 1;
        }
        // Una cadena sin cerrar no se come el resto del archivo
        if (ch === '\n' && quote !== '`') {
            return i + 1;
        }
        i++;
    }
    return to;
}

// ── Convenciones de nombres ──────────────────────────────────────────────────

/**
 * Prefijo más largo seguido de límite de palabra (mayúscula, no-letra o fin).
 * Evita que "Is" case con "Issue".
 */
function matchPrefix(word: string): string | undefined {
    const whole = rules.prefix.get(word);
    if (whole !== undefined) {
        return whole;
    }

    for (const key of rules.prefixKeys) {
        if (word.length < key.length) {
            continue;
        }
        if (word.startsWith(key) === false) {
            continue;
        }
        if (word.length === key.length) {
            return rules.prefix.get(key);
        }
        const next = word[key.length];
        if (UPPER.test(next) || LETTER.test(next) === false) {
            return rules.prefix.get(key);
        }
    }
    return undefined;
}

/**
 * Sufijo más largo que abre un segmento PascalCase (el carácter anterior es
 * minúscula). Evita que "C" case con "ABC".
 */
function matchSuffix(word: string): string | undefined {
    for (const key of rules.suffixKeys) {
        if (word.length <= key.length) {
            continue;
        }
        if (word.endsWith(key) === false) {
            continue;
        }
        const before = word[word.length - key.length - 1];
        if (LOWER.test(before)) {
            return rules.suffix.get(key);
        }
    }
    return undefined;
}

// ── Clasificación de código ──────────────────────────────────────────────────

const VB_NAME_DEFINERS = new Set(['function', 'sub', 'property', 'class']);
const JS_NAME_DEFINERS = new Set(['function', 'class']);

/** Palabras tras las que un identificador con paréntesis es una llamada, no una declaración. */
const CALL_INTRODUCERS = new Set([
    'return', 'new', 'await', 'throw', 'in', 'is', 'as', 'typeof', 'instanceof',
    'yield', 'case', 'else', 'do', 'of', 'from', 'and', 'or', 'not',
]);

/** Primer carácter con contenido a partir de `from`, o cadena vacía. */
function nextSignificant(text: string, from: number, to: number): string {
    let i = from;
    while (i < to && /\s/.test(text[i])) {
        i++;
    }
    return i < to ? text[i] : '';
}

/** Primer carácter con contenido antes de `before`, o cadena vacía. */
function prevSignificant(text: string, before: number, from: number): string {
    let i = before - 1;
    while (i >= from && /\s/.test(text[i])) {
        i--;
    }
    return i >= from ? text[i] : '';
}

/**
 * Nombre de un método que se está declarando: va seguido de `(`, no cuelga de un
 * punto y lo precede el tipo de retorno. Así entran `Task<int> SaveCliente(` y
 * `void Procesar(`, y quedan fuera `repo.GetById(` y `return BadRequest(`.
 */
function isDeclarationName(text: string, tokens: Token[], index: number, from: number, to: number, isKeyword: boolean): boolean {
    if (isKeyword || index === 0) {
        return false;
    }
    if (nextSignificant(text, tokens[index].end, to) !== '(') {
        return false;
    }
    if (prevSignificant(text, tokens[index].start, from) === '.') {
        return false;
    }
    return CALL_INTRODUCERS.has(tokens[index - 1].text.toLowerCase()) === false;
}

function classifyCode(text: string, from: number, to: number, lang: CodeLang, out: Hit[]): void {
    const { tokens, strings, comments } = tokenize(text, from, to, lang);
    const keywords = rules.keywords[lang];

    classifyAttributes(text, from, to, lang, out);

    for (const comment of comments) {
        out.push({ start: comment.start, end: comment.end, format: 'comment' });
    }

    for (const literal of strings) {
        out.push({ start: literal.start, end: literal.end, format: 'stringLiteral' });
        if (literal.interpolated) {
            classifyInterpolations(text, literal, lang, out);
        }
    }

    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const word = token.text;
        const lower = word.toLowerCase();
        const previous = i > 0 ? tokens[i - 1].text : '';

        if (token.isNumber) {
            push(out, token, 'literalNumber');
            continue;
        }

        // Nombre de lo que se está definiendo, tomado del token anterior
        if (lang === 'vb' && VB_NAME_DEFINERS.has(previous.toLowerCase())) {
            push(out, token, 'methodNameDefinition');
            continue;
        }
        if (lang === 'js' && JS_NAME_DEFINERS.has(previous)) {
            push(out, token, 'methodNameDefinition');
            continue;
        }
        if (lang !== 'vb' && isDeclarationName(text, tokens, i, from, to, keywords.has(word))) {
            push(out, token, 'methodNameDefinition');
            continue;
        }

        // "var" de C# antes que cualquier otra regla
        if (lang === 'cs' && word === 'var') {
            push(out, token, 'dimVarRedim');
            continue;
        }

        // "End" hereda el color de la palabra que le sigue: End If, End Sub...
        if (lang === 'vb' && lower === 'end' && i < tokens.length - 1) {
            const nextFormat = keywords.get(tokens[i + 1].text.toLowerCase());
            if (nextFormat !== undefined) {
                push(out, token, nextFormat);
                continue;
            }
        }

        const keywordFormat = keywords.get(lang === 'vb' ? lower : word);
        if (keywordFormat !== undefined) {
            push(out, token, keywordFormat);
            continue;
        }

        const exactFormat = rules.exact.get(lower);
        if (exactFormat !== undefined) {
            push(out, token, exactFormat);
            continue;
        }

        const prefixFormat = matchPrefix(word);
        if (prefixFormat !== undefined) {
            push(out, token, prefixFormat);
            continue;
        }

        const suffixFormat = matchSuffix(word);
        if (suffixFormat !== undefined) {
            push(out, token, suffixFormat);
        }
    }
}

/**
 * Los atributos son andamiaje, no lógica: se atenúan enteros. Se reconocen por
 * ocupar su propia línea entre corchetes (`[HttpPost(...)]`) o, en VB, entre
 * ángulos (`<Extension>`).
 */
function classifyAttributes(text: string, from: number, to: number, lang: CodeLang, out: Hit[]): void {
    if (lang === 'js') {
        return;
    }
    const [open, close] = lang === 'vb' ? ['<', '>'] : ['[', ']'];

    let lineStart = from;
    while (lineStart < to) {
        let lineEnd = text.indexOf('\n', lineStart);
        if (lineEnd === -1 || lineEnd > to) {
            lineEnd = to;
        }

        const line = text.slice(lineStart, lineEnd);
        const trimmed = line.trimEnd().replace(/\r$/, '');
        const indent = line.length - line.trimStart().length;

        if (trimmed.trimStart().startsWith(open) && trimmed.endsWith(close)) {
            out.push({ start: lineStart + indent, end: lineStart + trimmed.length, format: 'attribute' });
        }

        lineStart = lineEnd + 1;
    }
}

/**
 * Colorea lo que hay dentro de los huecos de una cadena interpolada, que es código
 * de verdad: `{file.FileName}` en C#, `${cliente.Nombre}` en JavaScript.
 */
function classifyInterpolations(text: string, literal: Trivia, lang: CodeLang, out: Hit[]): void {
    const opener = lang === 'js' ? '${' : '{';
    let i = literal.start;

    while (i < literal.end) {
        const open = text.indexOf(opener, i);
        if (open === -1 || open >= literal.end) {
            return;
        }

        // En C#, `{{` es una llave escapada, no un hueco
        if (lang !== 'js' && text[open + 1] === '{') {
            i = open + 2;
            continue;
        }

        const brace = lang === 'js' ? open + 1 : open;
        const close = matchingBrace(text, brace);
        if (close === -1 || close > literal.end) {
            return;
        }

        classifyCode(text, brace + 1, close, lang, out);
        i = close + 1;
    }
}

function push(out: Hit[], token: Token, format: string): void {
    out.push({ start: token.start, end: token.end, format });
}

function raw(out: Hit[], start: number, length: number, format: string): void {
    if (length > 0) {
        out.push({ start, end: start + length, format });
    }
}

// ── Clasificación de marcado ─────────────────────────────────────────────────

function classifyHtml(text: string, from: number, to: number, out: Hit[], razor: boolean): void {
    let lineStart = from;

    while (lineStart < to) {
        let lineEnd = text.indexOf('\n', lineStart);
        if (lineEnd === -1 || lineEnd > to) {
            lineEnd = to;
        }
        const line = text.slice(lineStart, lineEnd);

        if (razor) {
            const at = line.toLowerCase().indexOf('@if');
            if (at !== -1) {
                raw(out, lineStart + at + 1, 2, 'ifElse');
            }
        }

        if (line.includes('<') && line.includes('>')) {
            htmlTags(line, lineStart, out);
            htmlTagPrefixes(line, lineStart, out);
            htmlTagSuffixes(line, lineStart, out);
            htmlAttributes(line, lineStart, out);
        }

        lineStart = lineEnd + 1;
    }
}

function htmlTags(line: string, base: number, out: Hit[]): void {
    const lower = line.toLowerCase();

    for (const [tag, format] of Object.entries(rules.html.tags)) {
        // <div ... y <div>
        for (const [pattern, length] of [[`<${tag} `, tag.length + 1], [`<${tag}>`, tag.length + 2]] as [string, number][]) {
            let index = lower.indexOf(pattern);
            while (index !== -1) {
                if (line.indexOf('>', index + 1) !== -1) {
                    raw(out, base + index, length, format);
                }
                index = lower.indexOf(pattern, index + 1);
            }
        }

        // </div>
        const close = `</${tag}>`;
        let index = lower.indexOf(close);
        while (index !== -1) {
            const gt = line.indexOf('>', index + 1);
            if (gt !== -1) {
                raw(out, base + index, gt - index + 1, format);
            }
            index = lower.indexOf(close, index + 1);
        }
    }
}

/** Recorre los `<` de la línea y devuelve dónde empieza y acaba cada nombre de etiqueta. */
function* tagNames(line: string): Generator<{ lt: number; nameStart: number; nameEnd: number; closing: boolean }> {
    let searchStart = 0;
    while (searchStart < line.length) {
        const lt = line.indexOf('<', searchStart);
        if (lt === -1) {
            return;
        }

        const closing = line[lt + 1] === '/';
        const nameStart = closing ? lt + 2 : lt + 1;
        let nameEnd = nameStart;
        while (nameEnd < line.length && line[nameEnd] !== ' ' && line[nameEnd] !== '>' && line[nameEnd] !== '/') {
            nameEnd++;
        }

        yield { lt, nameStart, nameEnd, closing };
        searchStart = lt + 1;
    }
}

function htmlTagPrefixes(line: string, base: number, out: Hit[]): void {
    for (const { lt, nameStart, nameEnd, closing } of tagNames(line)) {
        for (const [prefix, format] of Object.entries(rules.html.tagPrefix)) {
            if (line.startsWith(prefix, nameStart) === false) {
                continue;
            }
            const gt = line.indexOf('>', lt);
            if (gt === -1) {
                continue;
            }
            // La etiqueta de cierre se pinta entera; la de apertura, sólo el nombre
            raw(out, base + lt, closing ? gt - lt + 1 : nameEnd - lt, format);
        }
    }
}

function htmlTagSuffixes(line: string, base: number, out: Hit[]): void {
    for (const { lt, nameStart, nameEnd, closing } of tagNames(line)) {
        if (nameEnd <= nameStart) {
            continue;
        }
        const name = line.slice(nameStart, nameEnd);

        for (const [suffix, format] of Object.entries(rules.html.tagSuffix)) {
            if (name.endsWith(suffix) === false || name.length <= suffix.length) {
                continue;
            }
            const gt = line.indexOf('>', lt);
            if (gt !== -1) {
                raw(out, base + lt, closing ? gt - lt + 1 : nameEnd - lt, format);
            }
            break;
        }
    }
}

/**
 * Resalta el nombre del atributo `class` o `style` sólo cuando es un atributo de
 * verdad: precedido de espacio o `<`, seguido de `=` y dentro de una etiqueta.
 * Así no cazan `className` ni `cssClass`.
 */
function htmlAttributes(line: string, base: number, out: Hit[]): void {
    const lower = line.toLowerCase();

    for (const [attr, format] of Object.entries(rules.html.attrs)) {
        let index = lower.indexOf(attr);
        while (index !== -1) {
            const before = line[index - 1];
            const beforeOk = index === 0 || before === '<' || /\s/.test(before);

            let after = index + attr.length;
            while (after < line.length && /\s/.test(line[after])) {
                after++;
            }
            const afterOk = line[after] === '=';

            if (beforeOk && afterOk) {
                const tagStart = line.lastIndexOf('<', index);
                const tagEnd = line.indexOf('>', index);
                if (tagStart !== -1 && tagEnd !== -1 && tagStart < tagEnd) {
                    raw(out, base + index, attr.length, format);
                }
            }
            index = lower.indexOf(attr, index + 1);
        }
    }
}

// ── Zonas por tipo de documento ──────────────────────────────────────────────

/** Devuelve el final del bloque `{...}` que abre en `open`, o -1. */
function matchingBrace(text: string, open: number): number {
    let depth = 0;
    let i = open;
    while (i < text.length) {
        const ch = text[i];
        if (ch === '"' || ch === "'") {
            i = skipString(text, i, text.length, ch, true);
            continue;
        }
        if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth--;
            if (depth === 0) {
                return i;
            }
        }
        i++;
    }
    return -1;
}

/** Bloques de C# de un archivo Razor: `@code {...}`, `@functions {...}`, `@{...}`. */
function razorCodeZones(text: string): Zone[] {
    const zones: Zone[] = [];
    const opener = /@(code|functions)?\s*\{/g;

    let match = opener.exec(text);
    while (match !== null) {
        const brace = text.indexOf('{', match.index);
        const close = matchingBrace(text, brace);
        if (close !== -1) {
            zones.push({ start: brace + 1, end: close, mode: 'cs' });
            opener.lastIndex = close;
        }
        match = opener.exec(text);
    }
    return zones;
}

/** Frontmatter `---...---` y bloques `<script>` de un archivo Astro. */
function astroCodeZones(text: string): Zone[] {
    const zones: Zone[] = [];

    if (text.startsWith('---')) {
        const close = text.indexOf('\n---', 3);
        if (close !== -1) {
            zones.push({ start: 3, end: close, mode: 'js' });
        }
    }

    const script = /<script\b[^>]*>/gi;
    let match = script.exec(text);
    while (match !== null) {
        const start = match.index + match[0].length;
        const end = text.toLowerCase().indexOf('</script', start);
        if (end === -1) {
            break;
        }
        zones.push({ start, end, mode: 'js' });
        script.lastIndex = end;
        match = script.exec(text);
    }
    return zones;
}

const CODE_LANGUAGES: Record<string, CodeLang> = {
    vb: 'vb',
    csharp: 'cs',
    javascript: 'js',
    javascriptreact: 'js',
    typescript: 'js',
    typescriptreact: 'js',
    vue: 'js',
    svelte: 'js',
};

const MARKUP_LANGUAGES = new Set(['html', 'razor', 'aspnetcorerazor', 'astro', 'handlebars', 'xml']);

/** ¿Sabe la extensión colorear este lenguaje? */
export function isSupported(languageId: string): boolean {
    return languageId in CODE_LANGUAGES || MARKUP_LANGUAGES.has(languageId);
}

function zonesFor(languageId: string, text: string): Zone[] {
    const codeLang = CODE_LANGUAGES[languageId];
    if (codeLang !== undefined) {
        return [{ start: 0, end: text.length, mode: codeLang }];
    }

    const zones: Zone[] = [{ start: 0, end: text.length, mode: 'html' }];

    if (languageId === 'razor' || languageId === 'aspnetcorerazor') {
        zones.push(...razorCodeZones(text));
    } else if (languageId === 'astro') {
        zones.push(...astroCodeZones(text));
    }

    return zones;
}

/**
 * Aplica el criterio Dinaup a un documento entero y devuelve los tramos a colorear.
 */
export function scan(text: string, languageId: string): Hit[] {
    const out: Hit[] = [];
    const razor = languageId === 'razor' || languageId === 'aspnetcorerazor';

    for (const zone of zonesFor(languageId, text)) {
        if (zone.mode === 'html') {
            classifyHtml(text, zone.start, zone.end, out, razor);
        } else {
            classifyCode(text, zone.start, zone.end, zone.mode, out);
        }
    }

    return out;
}
