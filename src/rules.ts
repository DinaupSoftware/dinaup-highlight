import rawRules from './rules.json';

/**
 * Un formato visual. Todo es opcional: un formato que sólo baja la opacidad deja
 * intacto el color que ya tenía el texto.
 */
export interface Format {
    fg?: string;
    bg?: string;
    /** Mismo tono que `fg`, oscurecido hasta ser legible sobre fondo claro. */
    fgLight?: string;
    /** Tinte claro equivalente a `bg`. */
    bgLight?: string;
    italic?: boolean;
    /** Tamaño relativo al del editor: 1.15 = un 15% más grande. */
    size?: number;
    /** De 0 a 1. Sirve para restar peso a lo secundario, como los atributos. */
    opacity?: number;
}

/** Lenguajes de código que el escáner sabe tokenizar. */
export type CodeLang = 'vb' | 'cs' | 'js';

/**
 * Las tablas del criterio, ya invertidas a "palabra -> nombre de formato" y
 * con las claves de prefijo/sufijo ordenadas de más larga a más corta para que
 * la coincidencia sea determinista (igual que _prefixKeys/_suffixKeys en DinaVSUP).
 */
/** Marca que se pone en el explorador a los archivos cuyo nombre acaba en `suffix`. */
export interface ExplorerRule {
    suffix: string;
    extensions: string[];
    badge: string;
    format: string;
    label: string;
    /** Color propio del explorador, cuando el del formato no funciona ahí. */
    color?: string;
}

/** Id del ThemeColor con el que se pinta una regla en el explorador. */
export function explorerColorId(rule: ExplorerRule): string {
    return rule.color === undefined
        ? `dinaupHighlight.${rule.format}`
        : `dinaupHighlight.explorer.${rule.suffix}`;
}

export interface Rules {
    formats: Record<string, Format>;
    explorer: ExplorerRule[];
    exact: Map<string, string>;
    prefix: Map<string, string>;
    suffix: Map<string, string>;
    prefixKeys: string[];
    suffixKeys: string[];
    keywords: Record<CodeLang, Map<string, string>>;
    html: {
        tags: Record<string, string>;
        tagPrefix: Record<string, string>;
        tagSuffix: Record<string, string>;
        attrs: Record<string, string>;
    };
}

interface RawRules {
    formats: Record<string, Format>;
    explorer: ExplorerRule[];
    exact: Record<string, string[]>;
    prefix: Record<string, string[]>;
    suffix: Record<string, string[]>;
    keywords: Record<string, Record<string, string[]>>;
    html: Rules['html'];
}

/**
 * Invierte { formato: [palabras] } en { palabra: formato }.
 * La primera aparición gana, igual que el AddM del original, que no sobrescribe.
 */
function invert(groups: Record<string, string[]>, lowercase: boolean): Map<string, string> {
    const map = new Map<string, string>();
    for (const [format, words] of Object.entries(groups)) {
        for (const word of words) {
            const key = lowercase ? word.toLowerCase() : word;
            if (map.has(key) === false) {
                map.set(key, format);
            }
        }
    }
    return map;
}

/** Claves ordenadas por longitud descendente, y alfabéticamente a igual longitud. */
function byLengthDesc(keys: Iterable<string>): string[] {
    return [...keys].sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0));
}

function build(): Rules {
    const raw = rawRules as unknown as RawRules;

    const prefix = invert(raw.prefix, false);
    const suffix = invert(raw.suffix, false);

    const keywords = {} as Record<CodeLang, Map<string, string>>;
    for (const lang of ['vb', 'cs', 'js'] as CodeLang[]) {
        // VB no distingue mayúsculas de minúsculas; C# y JS sí.
        keywords[lang] = invert(raw.keywords[lang], lang === 'vb');
    }

    return {
        formats: raw.formats,
        // El sufijo más largo primero: "Subpage" tiene que ganarle a "Page"
        explorer: [...raw.explorer].sort((a, b) => b.suffix.length - a.suffix.length),
        exact: invert(raw.exact, true),
        prefix,
        suffix,
        prefixKeys: byLengthDesc(prefix.keys()),
        suffixKeys: byLengthDesc(suffix.keys()),
        keywords,
        html: raw.html,
    };
}

export const rules: Rules = build();

/** Nombres de todos los formatos declarados, en orden de aparición. */
export const formatNames: string[] = Object.keys(rules.formats);
