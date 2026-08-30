import * as vscode from 'vscode';

/** Una variable de entorno de Dinaup, con su valor y de dónde ha salido. */
export interface Variable {
    name: string;
    value: string;
    /** Dónde estaba: el sistema o el archivo .env que sea. */
    origin: string;
    secret: boolean;
}

export interface Workspace {
    /** Paquetes de Dinaup encontrados en los proyectos del workspace. */
    packages: string[];
    variables: Variable[];
}

const PROJECT_FILES = '**/*.{csproj,vbproj,props,targets}';
const IGNORED = '**/{node_modules,bin,obj,.git}/**';

/**
 * `Include` de cualquier PackageReference/PackageVersion. El filtro por nombre se
 * hace después, con una comparación de texto: meter la alternativa dentro de la
 * expresión la vuelve cuadrática sobre archivos que no casan.
 */
const PACKAGE_INCLUDE = /(?:PackageReference|PackageVersion)\s[^>]*?Include="([^"]*)"/gi;
const DINAUP_NAMES = ['dinaup', 'dinazen'];

/**
 * Nombres cuyo valor no se enseña nunca. Cubre lo que promete el ajuste
 * `environmentVariables` —Secret, Token, Password, Key— y además las formas que
 * aparecen de verdad en los .env: PWD, CREDENTIAL, AUTH, CONNECTIONSTRING, SALT…
 */
const SECRET_NAME = /secret|password|passwd|pwd|token|key|credential|auth|connectionstring|salt|cert|private|signature/i;

/** Archivos de variables, del más general al que manda. */
const ENV_FILES = ['.env', '.env.local'];

/** Un .env es un archivo de configuración: por encima de esto, no se lee. */
const ENV_MAX_BYTES = 256 * 1024;

/** Tope de archivos de proyecto que se abren para buscar paquetes de Dinaup. */
const MAX_PROJECT_FILES = 300;

/**
 * Paquetes de Dinaup referenciados por cualquier proyecto del workspace. Vacío
 * significa que esto no es una app conectada a Dinaup.
 */
export async function findDinaupPackages(): Promise<string[]> {
    const projects = await vscode.workspace.findFiles(PROJECT_FILES, IGNORED, MAX_PROJECT_FILES);

    // En paralelo: en un monorepo son cientos de archivos y en serie se nota.
    const perFile = await Promise.all(projects.map(async project => {
        try {
            const text = Buffer.from(await vscode.workspace.fs.readFile(project)).toString('utf8');
            return [...text.matchAll(PACKAGE_INCLUDE)]
                .map(match => match[1])
                .filter(name => DINAUP_NAMES.some(needle => name.toLowerCase().includes(needle)));
        } catch {
            return [];
        }
    }));

    return [...new Set(perFile.flat())].sort();
}

/**
 * Busca cada variable primero en los archivos .env del workspace y, si no está,
 * en el entorno del sistema. Lo del proyecto manda sobre lo de la máquina.
 */
export async function readVariables(names: string[]): Promise<Variable[]> {
    const fromFiles = await readEnvFiles();

    return names.map(name => {
        const key = name.toLowerCase();
        const secret = SECRET_NAME.test(name);

        const inFile = fromFiles.get(key);
        if (inFile !== undefined) {
            return { name, value: inFile.value, origin: inFile.origin, secret };
        }

        const inSystem = Object.entries(process.env).find(([variable]) => variable.toLowerCase() === key);
        if (inSystem !== undefined && inSystem[1] !== undefined && inSystem[1] !== '') {
            return { name, value: inSystem[1], origin: 'variable del sistema', secret };
        }

        return { name, value: '', origin: 'sin definir', secret };
    });
}

/** Contenido de los .env de todas las carpetas del workspace, ya combinado. */
async function readEnvFiles(): Promise<Map<string, { value: string; origin: string }>> {
    const values = new Map<string, { value: string; origin: string }>();

    for (const folder of vscode.workspace.workspaceFolders ?? []) {
        for (const fileName of ENV_FILES) {
            const uri = vscode.Uri.joinPath(folder.uri, fileName);
            let text: string;
            try {
                const bytes = await vscode.workspace.fs.readFile(uri);
                if (bytes.byteLength > ENV_MAX_BYTES) {
                    continue;
                }
                text = Buffer.from(bytes).toString('utf8');
            } catch {
                continue;
            }
            for (const [key, value] of parseEnv(text)) {
                values.set(key, { value, origin: fileName });
            }
        }
    }

    return values;
}

/** CLAVE=valor por línea, con comentarios y comillas fuera. */
function parseEnv(text: string): Map<string, string> {
    const values = new Map<string, string>();

    for (const line of text.split('\n')) {
        const clean = line.trim();
        if (clean === '' || clean.startsWith('#')) {
            continue;
        }

        const equals = clean.indexOf('=');
        if (equals <= 0) {
            continue;
        }

        const key = clean.slice(0, equals).trim().replace(/^export\s+/, '');
        let value = clean.slice(equals + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }

        values.set(key.toLowerCase(), value);
    }

    return values;
}

/** Lo que se enseña de una variable: los secretos nunca salen en claro. */
export function display(variable: Variable): string {
    if (variable.value === '') {
        return 'sin definir';
    }
    return variable.secret ? '****' : variable.value;
}
