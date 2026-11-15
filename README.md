# TurboPasión

Sitio de noticias del motor que se actualiza solo cada hora. Lee los canales RSS de medios
especializados, y publica titular + extracto breve + enlace a la fuente original.

No necesita servidor ni base de datos: es un sitio estático que se regenera con un solo comando.

## Probarlo en tu computadora

```bash
node build.mjs
```

```bash
node serve.mjs
```

Luego abre http://localhost:4173

## Publicarlo gratis y dejarlo automático (GitHub Pages)

1. Crea una cuenta en https://github.com y un repositorio **público** nuevo (por ejemplo `turbopasion`).
2. Sube todos estos archivos al repositorio (rama `main`).
3. En el repositorio: **Settings → Pages → Source: GitHub Actions**.
4. Listo. El archivo `.github/workflows/actualizar.yml` regenera y publica el sitio cada hora.
   Puedes forzar una actualización en **Actions → Actualizar TurboPasión → Run workflow**.

Tu sitio quedará en `https://TU-USUARIO.github.io/turbopasion/`.

> GitHub pausa las tareas programadas si el repositorio pasa 60 días sin cambios.
> Te avisa por correo y se reactiva con un clic; publicar un artículo propio de vez en cuando lo evita.

## Dominio propio (necesario para AdSense)

Google AdSense pide un dominio propio (ej. `turbopasion.com`), no acepta subdominios `github.io`.

1. Compra el dominio (Namecheap, GoDaddy, Cloudflare…).
2. En GitHub: **Settings → Pages → Custom domain** y sigue las instrucciones de DNS.
3. En `config.json` pon `"siteUrl": "https://turbopasion.com"`.

## Activar Google AdSense

1. Solicita la cuenta en https://adsense.google.com con tu dominio.
2. Copia tu ID de editor (`ca-pub-1234567890123456`) en `config.json` → `adsense.client`.
   Con eso el sitio ya carga el código de AdSense en todas las páginas y genera `ads.txt`.
3. Opcional: crea bloques de anuncios en AdSense y pega sus números en `adsense.slots`
   (`top`, `infeed`, `bottom`, `article`). Si los dejas vacíos, activa los **anuncios automáticos**
   en AdSense y Google elige dónde colocarlos.
4. En AdSense → **Privacidad y mensajes**, activa el mensaje de consentimiento (obligatorio para
   visitantes de Europa).
5. Pon `"showPlaceholders": false` para ocultar los recuadros «Espacio publicitario».

## Publicar artículos propios

Crea un archivo `.md` en la carpeta `posts/`:

```markdown
---
title: Los 5 SUV más vendidos del año
date: 2026-11-20
description: Resumen corto que aparece en la portada y en Google.
image: https://tudominio.com/foto.jpg
---

Texto del artículo. Usa **negritas**, *cursivas*, [enlaces](https://ejemplo.com),
listas con guiones y títulos con ## al inicio de la línea.
```

Aparecen en la sección «De la redacción» de la portada.

## Personalizar

Todo está en `config.json`:

| Clave | Para qué sirve |
| --- | --- |
| `feeds` | Medios de los que se leen noticias. Agrega o quita los que quieras. |
| `categories` | Secciones y las palabras clave que clasifican cada noticia. |
| `contactEmail` | Correo que aparece en Contacto, Privacidad y Aviso legal. **Cámbialo.** |
| `showImages` | `false` para no mostrar las miniaturas de los medios. |
| `itemsPerPage`, `maxPages` | Noticias por página y número de páginas. |

Los colores y el diseño están en `src/style.css`.
