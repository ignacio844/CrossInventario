# Cloudflare · Control de inventario

La aplicación React y su gateway se publican juntos con Workers Static Assets. Se conservan Google Sheets, Apps Script, las sesiones Google, los identificadores de operación y el descargador de producción. El archivo `wrangler.jsonc` solo contiene identificadores públicos; no necesita contraseñas ni claves SGL.

1. Autorizar la herramienta oficial: `npx wrangler@4 login`.
2. Comprobar la cuenta: `npx wrangler@4 whoami`.
3. Publicar con `npx wrangler@4 deploy`. La compilación de producción excluye `public/seed.json` y cualquier inventario local.
4. En el mismo cliente OAuth de Google, agregar el origen HTTPS exacto de la URL publicada en **Orígenes autorizados de JavaScript**. No se necesita una URI de callback para el botón Google Identity usado aquí. Conservar los otros orígenes.
5. Comprobar ingreso Google, lectura del inventario y registro confirmado de acciones.

Las rutas `/api/*` llegan al Worker; los demás recursos se sirven como archivos estáticos. Las respuestas privadas tienen `Cache-Control: no-store`. Nunca se guarda una sesión o inventario compartido en una caché pública.

El plan gratuito de Workers tiene límites propios de solicitudes y CPU. Los archivos estáticos no consumen solicitudes de Worker. No se habilitan productos pagos, bases D1 ni almacenamiento R2 para esta migración; los datos operativos siguen en Google.

El dominio `cross-inventario.vercel.app` pertenece a Vercel y no puede trasladarse a Cloudflare. Distribuir a los usuarios la nueva URL una vez verificada. Las sesiones existentes en el dominio anterior no se transfieren automáticamente: cada usuario ingresará con su misma cuenta Google en el nuevo origen.
