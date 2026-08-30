import * as vscode from 'vscode';
import { rules, formatNames, Format } from './rules';
import { scan, isSupported } from './scanner';
import { ExplorerMarks } from './explorer';
import { findDinaupPackages, readVariables, display, Variable } from './dinaup';

const SECTION = 'dinaupHighlight';

const explorerMarks = new ExplorerMarks();
let dinaupStatus: vscode.StatusBarItem;
let dinaupPackages: string[] = [];

let decorations = new Map<string, vscode.TextEditorDecorationType>();
let enabled = true;
let maxFileSizeKB = 1024;
const pending = new Map<string, NodeJS.Timeout>();

/** Se apaga en deactivate: corta el trabajo en vuelo de los handlers asíncronos. */
let alive = true;

/** El estrechamiento de tipos de TS no sabe que un await puede apagar esto por el camino. */
function isAlive(): boolean {
    return alive;
}
let statusTimer: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext): void {
    alive = true;
    readSettings();
    buildDecorations();

    context.subscriptions.push(
        vscode.commands.registerCommand(`${SECTION}.toggle`, () => {
            const config = vscode.workspace.getConfiguration(SECTION);
            // Se escribe donde el usuario tenga puesto el ajuste; si no lo ha tocado, en Global.
            const target = whereIsEnableSet(config);
            config.update('enable', enabled === false, target);
        }),

        vscode.commands.registerCommand(`${SECTION}.findAllReferences`, findAllReferences),

        vscode.window.onDidChangeActiveTextEditor(updateToolbarVisibility),

        vscode.window.onDidChangeVisibleTextEditors(editors => {
            for (const editor of editors) {
                schedule(editor, 0);
            }
        }),

        vscode.workspace.onDidChangeTextDocument(event => {
            for (const editor of vscode.window.visibleTextEditors) {
                if (editor.document === event.document) {
                    schedule(editor, 120);
                }
            }
        }),

        vscode.workspace.onDidCloseTextDocument(forgetDocument),

        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration(SECTION) === false) {
                return;
            }
            readSettings();
            buildDecorations();
            refreshAll();
        }),

        // Al pasar de tema oscuro a claro (o al revés) toca rehacer la paleta entera
        vscode.window.onDidChangeActiveColorTheme(() => {
            buildDecorations();
            refreshAll();
        }),

        vscode.window.registerFileDecorationProvider(explorerMarks),
        explorerMarks,

        vscode.commands.registerCommand(`${SECTION}.showEnvironment`, showEnvironment),

        { dispose: disposeDecorations },
    );

    dinaupStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    dinaupStatus.command = `${SECTION}.showEnvironment`;
    context.subscriptions.push(dinaupStatus);

    // Sólo los .env que el lector abre de verdad: la raíz de cada carpeta del workspace.
    const envWatcher = vscode.workspace.createFileSystemWatcher('**/.env{,.local}');
    context.subscriptions.push(
        envWatcher,
        envWatcher.onDidChange(scheduleStatusRefresh),
        envWatcher.onDidCreate(scheduleStatusRefresh),
        envWatcher.onDidDelete(scheduleStatusRefresh),
        // Añadir o quitar una carpeta cambia tanto los paquetes como los .env en juego
        vscode.workspace.onDidChangeWorkspaceFolders(scheduleStatusRefresh),
        vscode.workspace.onDidGrantWorkspaceTrust(scheduleStatusRefresh),
        { dispose: cancelPendingWork },
    );

    updateToolbarVisibility(vscode.window.activeTextEditor);
    scheduleStatusRefresh();
    refreshAll();
}

/**
 * Cada evento de .env dispara un re-escaneo del workspace, así que se agrupan:
 * guardar cinco archivos seguidos cuesta un escaneo, no cinco.
 */
function scheduleStatusRefresh(): void {
    if (statusTimer !== undefined) {
        clearTimeout(statusTimer);
    }
    statusTimer = setTimeout(() => {
        statusTimer = undefined;
        void refreshDinaupStatus();
    }, 400);
}

/** Dónde tiene el usuario puesto `enable`, para que el comando lo cambie ahí y no en otro sitio. */
function whereIsEnableSet(config: vscode.WorkspaceConfiguration): vscode.ConfigurationTarget {
    const where = config.inspect<boolean>('enable');
    if (where?.workspaceFolderValue !== undefined) {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    if (where?.workspaceValue !== undefined) {
        return vscode.ConfigurationTarget.Workspace;
    }
    return vscode.ConfigurationTarget.Global;
}

// ── Entorno de Dinaup ────────────────────────────────────────────────────────

function variableNames(): string[] {
    return vscode.workspace.getConfiguration(SECTION).get<string[]>('environmentVariables', []);
}

/** Longitud máxima de un valor de entorno en la barra: más que eso la desborda. */
const HEADLINE_MAX = 24;

/**
 * Recorta y neutraliza un texto que viene del workspace antes de pintarlo en la
 * barra de estado: ahí `$(nombre)` se interpreta como icono, así que se rompe la
 * secuencia. No hay escape oficial para esto, sólo evitar el par `$(`.
 */
function forStatusBar(text: string): string {
    const flat = text.replace(/\s+/g, ' ').replace(/\$\(/g, '(').trim();
    return flat.length > HEADLINE_MAX ? `${flat.slice(0, HEADLINE_MAX - 1)}…` : flat;
}

/**
 * Deja un nombre ajeno listo para meterlo entre acentos graves en el tooltip:
 * dentro de un code span lo único que se escapa es el propio acento grave, que
 * cerraría el tramo y dejaría inyectar Markdown.
 */
function forCodeSpan(text: string): string {
    return text.replace(/`/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * El indicador sólo aparece si el workspace referencia algún paquete de Dinaup:
 * en un proyecto que no es de Dinaup no pinta nada. En un workspace sin confiar
 * no se lee nada del disco y el indicador se queda escondido.
 */
async function refreshDinaupStatus(): Promise<void> {
    if (isAlive() === false || dinaupStatus === undefined) {
        return;
    }

    try {
        const wanted = vscode.workspace.getConfiguration(SECTION).get<boolean>('environmentIndicator', true);
        if (wanted === false || vscode.workspace.isTrusted === false) {
            dinaupPackages = [];
            markDinaupWorkspace(false);
            dinaupStatus.hide();
            return;
        }

        dinaupPackages = await findDinaupPackages();
        if (isAlive() === false) {
            return;
        }
        markDinaupWorkspace(dinaupPackages.length > 0);
        if (dinaupPackages.length === 0) {
            dinaupStatus.hide();
            return;
        }

        const variables = await readVariables(variableNames());
        if (isAlive() === false) {
            return;
        }

        const defined = variables.filter(variable => variable.value !== '');
        const headline = defined
            .filter(variable => variable.secret === false)
            .slice(0, 2)
            .map(variable => forStatusBar(variable.value))
            .filter(value => value !== '');

        dinaupStatus.text = headline.length > 0 ? `$(plug) ${headline.join(' · ')}` : '$(plug) Dinaup';
        dinaupStatus.tooltip = new vscode.MarkdownString(
            [
                `**App conectada a Dinaup**`,
                '',
                ...dinaupPackages.map(name => `- \`${forCodeSpan(name)}\``),
                '',
                `${defined.length} de ${variables.length} variables definidas. Clic para verlas.`,
            ].join('\n'),
        );
        dinaupStatus.show();
    } catch {
        // Un workspace ilegible no es motivo para romper nada: el indicador se esconde.
        markDinaupWorkspace(false);
        dinaupStatus.hide();
    }
}

/** Gobierna si el comando del entorno aparece en la paleta: sólo en proyectos de Dinaup. */
function markDinaupWorkspace(isDinaup: boolean): void {
    void vscode.commands.executeCommand('setContext', `${SECTION}.isDinaupWorkspace`, isDinaup);
}

/** Lista las variables con su valor y su procedencia. El secreto nunca sale en claro. */
async function showEnvironment(): Promise<void> {
    if (vscode.workspace.isTrusted === false) {
        await vscode.window.showWarningMessage(
            'El entorno de Dinaup no se lee en carpetas sin confiar. Confía en el workspace y vuelve a intentarlo.',
        );
        return;
    }

    if (vscode.workspace.getConfiguration(SECTION).get<boolean>('environmentIndicator', true) === false) {
        await vscode.window.showInformationMessage(
            'El indicador de entorno está desactivado en los ajustes (dinaupHighlight.environmentIndicator).',
        );
        return;
    }

    if (dinaupPackages.length === 0) {
        await vscode.window.showInformationMessage(
            'Este workspace no referencia ningún paquete de Dinaup, así que no se lee su entorno.',
        );
        return;
    }

    const variables = await readVariables(variableNames());

    const items = variables.map(variable => ({
        label: variable.name,
        description: display(variable),
        detail: variable.value === '' ? 'No está ni en el sistema ni en ningún .env' : `Viene de: ${variable.origin}`,
        variable,
    }));

    const chosen = await vscode.window.showQuickPick(items, {
        title: `Entorno Dinaup — ${dinaupPackages.length} paquete(s) detectado(s)`,
        placeHolder: 'Elige una para copiar su valor',
    });

    if (chosen === undefined || chosen.variable.value === '') {
        return;
    }
    if (chosen.variable.secret) {
        vscode.window.showWarningMessage(`${chosen.variable.name} es un secreto: no se copia ni se muestra.`);
        return;
    }

    await vscode.env.clipboard.writeText(chosen.variable.value);
    vscode.window.showInformationMessage(`${chosen.variable.name} copiado.`);
}

// ── Barra de herramientas del editor ─────────────────────────────────────────

/** Los botones sólo aparecen en los archivos que la extensión entiende. */
function updateToolbarVisibility(editor: vscode.TextEditor | undefined): void {
    const supported = editor !== undefined && isSupported(editor.document.languageId);
    vscode.commands.executeCommand('setContext', `${SECTION}.supported`, supported);
}

/**
 * Abre la lista de referencias en el panel lateral. Si esa vista no está
 * disponible, cae en la vista emergente que trae el editor de serie.
 */
async function findAllReferences(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) {
        return;
    }

    const available = await vscode.commands.getCommands(true);
    if (available.includes('references-view.findReferences')) {
        await vscode.commands.executeCommand('references-view.findReferences', editor.document.uri, editor.selection.active);
        return;
    }
    await vscode.commands.executeCommand('editor.action.goToReferences');
}

export function deactivate(): void {
    alive = false;
    cancelPendingWork();
    disposeDecorations();
}

/** Cancela todo lo que estuviera esperando a un temporizador. */
function cancelPendingWork(): void {
    alive = false;
    for (const timer of pending.values()) {
        clearTimeout(timer);
    }
    pending.clear();

    if (statusTimer !== undefined) {
        clearTimeout(statusTimer);
        statusTimer = undefined;
    }
}

// ── Ajustes y decoraciones ───────────────────────────────────────────────────

function readSettings(): void {
    const config = vscode.workspace.getConfiguration(SECTION);
    enabled = config.get<boolean>('enable', true);
    maxFileSizeKB = config.get<number>('maxFileSizeKB', 1024);
    explorerMarks.setEnabled(config.get<boolean>('explorerMarks', true));
}

/** Los temas claros necesitan la paleta oscurecida: la de siempre no se lee sobre blanco. */
function onLightTheme(): boolean {
    const kind = vscode.window.activeColorTheme.kind;
    return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight;
}

/**
 * Un tipo de decoración por formato. Los colores salen de rules.json —la paleta
 * clara u oscura según el tema activo— y se pueden pisar uno a uno desde el
 * ajuste `dinaupHighlight.colors`.
 */
function buildDecorations(): void {
    disposeDecorations();

    const overrides = vscode.workspace.getConfiguration(SECTION).get<Record<string, string>>('colors', {});
    const light = onLightTheme();

    for (const name of formatNames) {
        const format: Format = rules.formats[name];

        decorations.set(name, vscode.window.createTextEditorDecorationType({
            color: overrides[name] ?? (light ? format.fgLight ?? format.fg : format.fg),
            backgroundColor: light ? format.bgLight ?? format.bg : format.bg,
            fontStyle: format.italic === true ? 'italic' : undefined,
            opacity: format.opacity === undefined ? undefined : String(format.opacity),
            textDecoration: sizeAsCss(format.size),
            rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
        }));
    }
}

/**
 * VS Code no expone el tamaño de fuente en las decoraciones, pero `textDecoration`
 * se inyecta como CSS en línea, así que el tamaño entra por ahí.
 */
function sizeAsCss(size: number | undefined): string | undefined {
    if (size === undefined || size === 1) {
        return undefined;
    }
    return `none; font-size: ${size}em; vertical-align: baseline`;
}

function disposeDecorations(): void {
    for (const decoration of decorations.values()) {
        decoration.dispose();
    }
    decorations = new Map();
}

// ── Aplicación ───────────────────────────────────────────────────────────────

function refreshAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
        schedule(editor, 0);
    }
}

/**
 * Agrupa las pulsaciones seguidas: sólo se repinta cuando el teclado descansa.
 * El temporizador va por documento, no por editor, porque el mismo documento
 * puede estar abierto en varios grupos y todos tienen que repintarse.
 */
function schedule(editor: vscode.TextEditor, delayMs: number): void {
    const document = editor.document;
    const key = document.uri.toString();

    const previous = pending.get(key);
    if (previous !== undefined) {
        clearTimeout(previous);
        pending.delete(key);
    }

    if (delayMs === 0) {
        apply(editor);
        return;
    }

    pending.set(key, setTimeout(() => {
        pending.delete(key);
        if (isAlive() === false) {
            return;
        }
        for (const visible of vscode.window.visibleTextEditors) {
            if (visible.document.uri.toString() === key) {
                apply(visible);
            }
        }
    }, delayMs));
}

/** Un documento que se cierra no tiene que dejar un temporizador vivo detrás. */
function forgetDocument(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const timer = pending.get(key);
    if (timer !== undefined) {
        clearTimeout(timer);
        pending.delete(key);
    }
}

function apply(editor: vscode.TextEditor): void {
    const document = editor.document;
    const supported = enabled && isSupported(document.languageId) && document.getText().length <= maxFileSizeKB * 1024;

    const ranges = new Map<string, vscode.Range[]>();
    for (const name of formatNames) {
        ranges.set(name, []);
    }

    if (supported) {
        for (const hit of scan(document.getText(), document.languageId)) {
            ranges.get(hit.format)?.push(new vscode.Range(document.positionAt(hit.start), document.positionAt(hit.end)));
        }
    }

    // Se asignan todos los formatos, incluidos los vacíos: así se limpia lo anterior
    for (const [name, decoration] of decorations) {
        editor.setDecorations(decoration, ranges.get(name) ?? []);
    }
}
