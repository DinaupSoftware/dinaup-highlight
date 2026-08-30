import * as vscode from 'vscode';
import { rules, ExplorerRule, explorerColorId } from './rules';

/**
 * Marca en el explorador los archivos cuyo nombre sigue la convención: tiñe el
 * nombre con el color del sufijo y le añade una insignia de una o dos letras.
 *
 * Los temas de iconos de VS Code sólo casan por extensión o por nombre exacto,
 * nunca por patrón, así que `ClientesService.cs` no puede llevar icono propio.
 * Esto es lo que sí se puede hacer, y encima se actualiza al vuelo.
 */
export class ExplorerMarks implements vscode.FileDecorationProvider {
    private readonly changed = new vscode.EventEmitter<undefined>();
    readonly onDidChangeFileDecorations = this.changed.event;

    private enabled = true;

    setEnabled(enabled: boolean): void {
        if (this.enabled !== enabled) {
            this.enabled = enabled;
            this.changed.fire(undefined);
        }
    }

    provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        if (this.enabled === false) {
            return undefined;
        }

        const rule = match(uri.path);
        if (rule === undefined) {
            return undefined;
        }

        return {
            badge: rule.badge,
            tooltip: rule.label,
            color: new vscode.ThemeColor(explorerColorId(rule)),
        };
    }

    dispose(): void {
        this.changed.dispose();
    }
}

/** Primera regla cuyo sufijo y extensión encajan con el nombre del archivo. */
function match(filePath: string): ExplorerRule | undefined {
    const name = filePath.slice(filePath.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    if (dot <= 0) {
        return undefined;
    }

    const base = name.slice(0, dot);
    const extension = name.slice(dot + 1).toLowerCase();

    return rules.explorer.find(rule => {
        if (rule.extensions.includes(extension) === false) {
            return false;
        }
        if (base.length <= rule.suffix.length || base.endsWith(rule.suffix) === false) {
            return false;
        }
        // El sufijo abre segmento: "ClientesU" sí, "MENU" no
        return /\p{Ll}/u.test(base[base.length - rule.suffix.length - 1]);
    });
}
