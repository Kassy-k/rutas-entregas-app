# Manifiesto de ruta — página web sobre GitHub Issues

Esta carpeta es el **código de la página** (sin ningún dato tuyo adentro).
Va en un repositorio **público** nuevo, distinto de `rutas-entregas` (que se
queda privado y es donde vive tu información real: pedidos, evidencia,
historial).

## Paso 1: Crear el repositorio público del código

1. En GitHub, crea un repositorio nuevo — por ejemplo `rutas-entregas-app`.
2. Esta vez elige **Public** (no Private). No pasa nada porque aquí no va
   ningún dato tuyo, solo el código de la página.
3. Sube estos archivos (`index.html`, `styles.css`, `config.js`, `app.js`)
   igual que subiste la plantilla antes: **Add file → Upload files**.

## Paso 2: Publicar con GitHub Pages

1. En ese mismo repositorio: **Settings → Pages**.
2. En **Source**, elige **Deploy from a branch**.
3. Rama `main`, carpeta `/ (root)` → **Save**.
4. En 1-2 minutos tu página queda en:
   `https://TU-USUARIO.github.io/rutas-entregas-app/`

## Paso 3: Generar la llave de acceso (una sola vez, tú como administrador)

1. En GitHub, click en tu foto de perfil (arriba a la derecha) → **Settings**.
2. Baja hasta el final del menú izquierdo → **Developer settings**.
3. **Personal access tokens → Fine-grained tokens → Generate new token**.
4. Llena:
   - **Token name**: `rutas-entregas-app`
   - **Expiration**: elige 1 año (la máxima disponible). ⚠️ Cuando venza,
     hay que generar una nueva y repetir el Paso 4 en cada teléfono — te
     conviene anotar la fecha en tu calendario.
   - **Repository access**: **Only select repositories** → elige
     `rutas-entregas` (el privado, el de los datos — **no** el nuevo público).
   - **Permissions → Repository permissions**:
     - `Issues`: **Read and write**
     - `Contents`: **Read and write**
     - `Metadata`: se marca solo (Read-only), es obligatorio.
5. **Generate token**.
6. Copia el token que empieza con `github_pat_...` — **solo se muestra una
   vez**, guárdalo en un lugar seguro (por ejemplo, en tu propio gestor de
   contraseñas) además de usarlo en el siguiente paso.

## Paso 4: Configurar cada teléfono (una sola vez por dispositivo)

1. Abre la página publicada (`https://TU-USUARIO.github.io/rutas-entregas-app/`)
   en el celular del operador.
2. Va a pedir la llave de acceso — pega el token del Paso 3.
3. Click en **"Guardar y continuar"**.
4. A partir de aquí, ese teléfono **ya no vuelve a pedir la llave** — el
   operador solo escribirá su nombre cada vez que entre.

> La llave queda guardada únicamente en la memoria de ese navegador
> (`localStorage`), nunca se sube a ningún repositorio ni la ve nadie más.

## Cómo se usa después de configurado

- **Operador**: escribe su nombre → agrega sus pedidos en orden → inicia
  ruta → por cada pedido, toca "Marcar entregado + fotos" y puede elegir
  **varias fotos a la vez** (útil si trae distintos almacenes en distintas
  hojas) → puede reordenar los pedidos pendientes en cualquier momento.
- **Administrador**: en la pantalla de nombre, toca **"Soy administrador"**
  en vez de escribir un nombre → ve todas las rutas del día → entra a
  cualquiera para ver el detalle y las fotos de evidencia.

## Dónde queda todo guardado

Cada ruta es un *Issue* en tu repositorio privado `rutas-entregas`
(pestaña **Issues**), con el checklist de pedidos y un comentario por cada
entrega. Las fotos se guardan como archivos dentro de ese mismo
repositorio, en la carpeta `evidence/`. Todo permanece ahí, organizado por
operador y fecha, para siempre — sin costo y sin depender de nada fuera de
GitHub.
