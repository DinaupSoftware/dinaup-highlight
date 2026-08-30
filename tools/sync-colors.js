// Copia a package.json los colores que el explorador necesita declarar.
//   node tools/sync-colors.js
//
// Las marcas del explorador se pintan con un ThemeColor, y un ThemeColor tiene
// que estar declarado en el manifiesto. El valor sigue viviendo en rules.json:
// esto sólo lo replica, para que no haya dos verdades.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'rules.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// Una regla puede llevar color propio cuando el del formato no funciona en el
// explorador: el rojo del controlador, ahí, parece un error.
const declared = new Map();
for (const rule of rules.explorer) {
    const id = rule.color === undefined
        ? `dinaupHighlight.${rule.format}`
        : `dinaupHighlight.explorer.${rule.suffix}`;
    const value = rule.color ?? rules.formats[rule.format].fg;
    declared.set(id, { value, label: rule.label });
}

manifest.contributes.colors = [...declared].map(([id, { value, label }]) => ({
    id,
    description: `Nombre en el explorador de los archivos: ${label}`,
    defaults: { dark: value, light: value, highContrast: value },
}));

fs.writeFileSync(path.join(ROOT, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`${declared.size} colores declarados en package.json.`);
