// Trae los iconos de archivo y escribe el tema que los declara.
//   node tools/build-icons.js
//
// Los SVG salen de Material Icon Theme (PKief), licencia MIT, y quedan guardados
// en icons/ dentro del repo: el empaquetado no toca la red.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICONS = path.join(ROOT, 'icons');
// El repo se movio de PKief/ a material-extensions/ y la licencia dejo de ser LICENSE.md.
const SOURCE = 'https://raw.githubusercontent.com/material-extensions/vscode-material-icon-theme/main';
const SOURCE_LICENSE = `${SOURCE}/LICENSE`;

/**
 * Descarga texto exigiendo un 200. Sin esto, un 404 se guardaba tal cual y la
 * extension acababa publicando "404: Not Found" como aviso de licencia MIT.
 */
async function fetchText(url) {
    const response = await fetch(url);
    if (response.ok === false) {
        throw new Error(`${url} -> HTTP ${response.status}`);
    }
    return response.text();
}

/** Icono de origen -> qué extensiones lo usan. El nombre es el del repo de Material. */
const BY_EXTENSION = {
    razor: ['razor', 'cshtml'],
    css: ['css'],
    sass: ['scss', 'sass', 'less'],
    csharp: ['cs', 'csx'],
    visualstudio: ['vb', 'sln', 'slnx', 'suo'],
    nuget: ['csproj', 'vbproj', 'props', 'targets', 'nuspec'],
    typescript: ['ts', 'mts', 'cts'],
    react_ts: ['tsx'],
    javascript: ['js', 'mjs', 'cjs'],
    react: ['jsx'],
    json: ['json', 'jsonc', 'json5'],
    html: ['html', 'htm'],
    astro: ['astro'],
    markdown: ['md', 'mdx', 'markdown'],
    yaml: ['yml', 'yaml'],
    xml: ['xml', 'xsd', 'config', 'vsixmanifest', 'resx'],
    database: ['sql'],
    console: ['sh', 'bash', 'cmd', 'bat'],
    powershell: ['ps1', 'psm1', 'psd1'],
    document: ['txt', 'log', 'rtf'],
    pdf: ['pdf'],
    zip: ['zip', 'rar', '7z', 'gz', 'tar', 'vsix', 'nupkg'],
    tune: ['env'],
    git: ['gitignore', 'gitattributes', 'gitmodules'],
    docker: ['dockerignore'],
    vue: ['vue'],
    svelte: ['svelte'],
    image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp'],
    svg: ['svg'],
    font: ['ttf', 'otf', 'woff', 'woff2'],
    settings: ['ini', 'toml', 'editorconfig'],
    lock: ['lock'],
    key: ['pem', 'key', 'crt', 'pfx'],
    certificate: ['cer', 'p12'],
};

/**
 * Iconos que Material no trae y se traen de otro sitio. Se guardan con el nombre
 * de la clave, así que en las tablas de arriba se usan igual que los demás.
 */
const FROM_ELSEWHERE = {
    // Logo oficial de Blazor. El morado de Visual Studio (#5c2d91) sobre un fondo
    // oscuro queda en 1.8:1 de contraste, así que en tema oscuro se aclara.
    blazor: {
        url: 'https://raw.githubusercontent.com/devicons/devicon/master/icons/blazor/blazor-original.svg',
        license: 'https://raw.githubusercontent.com/devicons/devicon/master/LICENSE',
        licenseFile: 'LICENSE-devicon.txt',
        extensions: ['razor', 'cshtml'],
        recolor: { from: '#5c2d91', to: '#A87BE8' },
    },
    // C# en verde. El de Material es azul; éste es el verde clásico, aclarado
    // porque #368832 sobre fondo oscuro se queda en 3.8:1
    csharp: {
        url: 'https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/icons/file_type_csharp.svg',
        license: 'https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/LICENSE',
        licenseFile: 'LICENSE-vscode-icons.txt',
        extensions: ['cs', 'csx'],
        recolor: { from: '#368832', to: '#4CAF50' },
    },
    // Carpetas doradas, como las del Explorador de soluciones de Visual Studio
    folder: {
        url: 'https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/icons/default_folder.svg',
        license: 'https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/LICENSE',
        licenseFile: 'LICENSE-vscode-icons.txt',
        role: 'folder',
    },
    'folder-open': {
        url: 'https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/icons/default_folder_opened.svg',
        license: 'https://raw.githubusercontent.com/vscode-icons/vscode-icons/master/LICENSE',
        licenseFile: 'LICENSE-vscode-icons.txt',
        role: 'folderExpanded',
    },
};

/** Contraste WCAG entre dos colores hexadecimales. */
function contrast(a, b) {
    const luminance = hex => {
        const channel = value => {
            const v = parseInt(value, 16) / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        const [r, g, bl] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(channel);
        return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
}

/** Nombre de archivo exacto: gana a la extensión. */
const BY_FILE_NAME = {
    'dockerfile': 'docker',
    'package.json': 'nodejs',
    'package-lock.json': 'nodejs',
    'tsconfig.json': 'tsconfig',
    'readme.md': 'readme',
    'license': 'certificate',
    '.gitignore': 'git',
    '.gitattributes': 'git',
    '.env': 'tune',
    '.vscodeignore': 'vscode',
};

const FILE_FALLBACK = 'document';
const FOLDER = 'folder-base';

async function download(name) {
    const response = await fetch(`${SOURCE}/icons/${name}.svg`);
    if (response.ok === false) {
        throw new Error(`${name}.svg -> HTTP ${response.status}`);
    }
    const svg = await response.text();
    fs.writeFileSync(path.join(ICONS, `${name}.svg`), svg);
}

async function main() {
    const names = new Set([
        ...Object.keys(BY_EXTENSION),
        ...Object.values(BY_FILE_NAME),
        FILE_FALLBACK,
        FOLDER,
    ]);

    fs.rmSync(ICONS, { recursive: true, force: true });
    fs.mkdirSync(ICONS, { recursive: true });

    const failed = [];
    for (const name of names) {
        try {
            await download(name);
        } catch (error) {
            failed.push(error.message);
        }
    }

    fs.writeFileSync(path.join(ICONS, 'LICENSE-material-icon-theme.md'), await fetchText(SOURCE_LICENSE));

    for (const [name, source] of Object.entries(FROM_ELSEWHERE)) {
        const icon = await fetch(source.url);
        if (icon.ok === false) {
            failed.push(`${name}.svg -> HTTP ${icon.status}`);
            continue;
        }
        const svg = await icon.text();
        names.add(name);

        if (source.recolor === undefined) {
            fs.writeFileSync(path.join(ICONS, `${name}.svg`), svg);
        } else {
            // El aclarado va en el icono normal, que es el que ve un tema oscuro;
            // el color original queda para los temas claros.
            const { from, to } = source.recolor;
            fs.writeFileSync(path.join(ICONS, `${name}.svg`), svg.split(from).join(to));
            fs.writeFileSync(path.join(ICONS, `${name}-ink.svg`), svg);
            names.add(`${name}-ink`);
            console.log(`${name}: ${from} sobre #1e1e1e daba ${contrast(from, '#1e1e1e').toFixed(1)}:1, ${to} da ${contrast(to, '#1e1e1e').toFixed(1)}:1`);
        }

        fs.writeFileSync(path.join(ICONS, source.licenseFile), await fetchText(source.license));
    }

    // ── Tema ──
    const iconDefinitions = {};
    for (const name of names) {
        iconDefinitions[`_${name}`] = { iconPath: `./icons/${name}.svg` };
    }

    const fileExtensions = {};
    for (const [icon, extensions] of Object.entries(BY_EXTENSION)) {
        for (const extension of extensions) {
            fileExtensions[extension] = `_${icon}`;
        }
    }
    // Lo de fuera manda sobre el mapeo de Material
    for (const [icon, source] of Object.entries(FROM_ELSEWHERE)) {
        for (const extension of source.extensions ?? []) {
            fileExtensions[extension] = `_${icon}`;
        }
    }

    const fileNames = {};
    for (const [file, icon] of Object.entries(BY_FILE_NAME)) {
        fileNames[file] = `_${icon}`;
    }

    // Un tema claro usa el color original, que ahí sí contrasta
    const lightExtensions = {};
    for (const [icon, source] of Object.entries(FROM_ELSEWHERE)) {
        if (source.recolor === undefined) {
            continue;
        }
        for (const extension of source.extensions) {
            lightExtensions[extension] = `_${icon}-ink`;
        }
    }

    const theme = {
        hidesExplorerArrows: false,
        iconDefinitions,
        file: `_${FILE_FALLBACK}`,
        folder: `_${FOLDER}`,
        folderExpanded: `_${FOLDER}`,
        fileExtensions,
        fileNames,
        light: { fileExtensions: lightExtensions },
    };

    // Un icono de fuera puede ocupar el papel de carpeta o de archivo genérico
    for (const [icon, source] of Object.entries(FROM_ELSEWHERE)) {
        if (source.role !== undefined) {
            theme[source.role] = `_${icon}`;
        }
    }

    fs.writeFileSync(path.join(ROOT, 'icon-theme.json'), JSON.stringify(theme, null, 2) + '\n');

    console.log(`${names.size - failed.length} iconos y ${Object.keys(fileExtensions).length} extensiones.`);
    if (failed.length > 0) {
        console.log('No se pudieron traer:\n  ' + failed.join('\n  '));
    }
}

main();
