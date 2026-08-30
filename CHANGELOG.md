# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/).
Versionado según [SemVer](https://semver.org/lang/es/).

## [2.0.0] — 2026-08-30

Primera versión pública en el Visual Studio Marketplace. Las 1.x fueron builds internos que se
instalaban a mano por VSIX y nunca se publicaron.

### Añadido

- **Paleta para temas claros.** Cada uno de los 97 formatos tiene ahora una variante oscurecida
  que conserva su tono y llega como mínimo a 4.5:1 de contraste sobre blanco. La paleta se elige
  sola según el tema activo y se rehace al cambiarlo. Hasta ahora sólo había colores de tema
  oscuro: en tema claro 87 de 96 formatos quedaban por debajo de 3:1 y uno era literalmente
  invisible (blanco sobre blanco).
- Los 13 colores del explorador también tienen variante clara y de alto contraste claro.
- Ajuste `dinaupHighlight.environmentIndicator` para apagar del todo el indicador de entorno. Con
  él apagado no se abre ningún archivo `.env`.
- Tema de iconos y coloreado documentados en la ficha, con capturas de la salida real.

### Cambiado

- **El enmascarado de secretos cubre lo que promete.** Antes sólo tapaba nombres con `secret`,
  `password`, `passwd`, `pwd`, `token`, `apikey` y `api_key`, pese a que el ajuste anunciaba
  también `Key`. Ahora incluye `key`, `credential`, `auth`, `connectionstring`, `salt`, `cert`,
  `private` y `signature`.
- `dinaupHighlight.environmentVariables` pasa a ámbito `machine`: un repositorio ajeno ya no puede
  decidir qué variables de entorno se leen y se enseñan.
- El indicador de entorno no lee nada en carpetas sin confiar. La extensión declara
  `capabilities.untrustedWorkspaces: limited`, así que el coloreado y las marcas del explorador
  siguen funcionando en Modo Restringido.
- El comando `Dinaup: Ver el entorno de Dinaup` sólo aparece en la paleta cuando el workspace
  referencia algún paquete de Dinaup.
- El comando de activar/desactivar escribe el ajuste donde el usuario lo tenga puesto —carpeta,
  workspace o global— en lugar de escribir siempre en global.
- Los eventos de `.env` se agrupan: guardar varios archivos seguidos cuesta un escaneo, no uno por
  archivo. El watcher vigila sólo los archivos que el lector abre de verdad.
- Los archivos de proyecto se leen en paralelo al buscar paquetes de Dinaup.
- `@types/vscode` fijado a 1.75.0, la misma versión que declara `engines.vscode`, para que el
  compilador no deje pasar API más nueva que el suelo anunciado.

### Corregido

- El aviso de licencia MIT de Material Icon Theme era una descarga fallida guardada en disco: el
  archivo contenía el texto `404: Not Found` y se empaquetaba así en el VSIX. Sustituido por el
  texto real y añadido `THIRD-PARTY-NOTICES.md` con la atribución de los tres proyectos de iconos.
- Un mismo documento abierto en dos grupos del editor sólo se repintaba en uno.
- Los temporizadores pendientes no se cancelaban al cerrar un documento ni al desactivar la
  extensión.
- Un fallo leyendo el workspace dejaba de ser una promesa sin capturar; ahora el indicador
  simplemente se esconde.
- El nombre de un paquete podía inyectar Markdown en el tooltip de la barra de estado, y un valor
  de `.env` podía suplantar iconos (`$(...)`) o desbordar la barra. Ambos se sanean y se recortan.
- Retroceso polinómico en la expresión que busca `PackageReference`: el filtro por nombre se hace
  ahora con una comparación de texto, fuera de la expresión.
- Se ignoran los `.env` de más de 256 KB.
- Añadir o quitar una carpeta del workspace ya refresca el indicador.

### Metadatos de publicación

- `icon`, `repository`, `bugs`, `homepage`, `qna`, `license`, `author`, `galleryBanner`,
  `pricing`, `extensionKind` y `capabilities` añadidos al manifest.
- Archivo `LICENSE` (MIT) añadido.
- Script `vscode:prepublish`: empaquetar compila, en lugar de comprimir el `out/` que hubiera.
- `private: true` retirado del manifest.
- `maxFileSizeKB` acotado entre 1 y 51200; `colors` valida que el valor sea `#RRGGBB`.
