# Proyectos Freelancer

Panel web local para recopilar, normalizar, consultar y organizar proyectos publicados en varias plataformas de trabajo freelance.

Actualmente integra:

- [Freelancer](https://www.freelancer.com/)
- [Workana](https://www.workana.com/)
- [SoyFreelancer](https://www.soyfreelancer.com/trabajos-freelance)

La aplicación unifica los anuncios en una sola interfaz, convierte los presupuestos a euros y conserva en disco los proyectos vistos, favoritos y perfiles de búsqueda.

## Funciones principales

- Actualización independiente de cada plataforma desde los bloques de resumen.
- Contadores y fecha de última actualización por fuente.
- Presupuestos convertidos y redondeados a euros.
- Búsqueda por título, descripción, habilidades y otros datos del anuncio.
- Exclusión de palabras o frases separadas por comas.
- Filtros por plataforma, país, idioma, habilidades, modalidad, precio y fecha.
- Selección de varias habilidades mediante etiquetas removibles.
- Habilidades pulsables desde las tarjetas y desde el detalle.
- Ordenación por fecha, título, país y precio.
- Perfiles de búsqueda persistentes y compartidos entre navegadores.
- Proyectos favoritos y proyectos vistos persistentes.
- Ocultación predeterminada de los proyectos vistos.
- Detalle ampliado con presupuesto, propuestas, publicación y enlace al anuncio.
- Paginación con salto directo entre páginas.
- Diseño adaptable a escritorio, tablet y móvil.

### Comportamiento de los filtros

- Las habilidades seleccionadas se combinan con lógica **Y**: el proyecto debe contenerlas todas.
- Las exclusiones separadas por comas se aplican con lógica **O**: basta con que aparezca una para ocultar el proyecto.
- El límite superior de la barra de precio es `10.000 €+`; cuando está en esa posición también incluye presupuestos superiores.
- La fecha permite seleccionar intervalos de dos horas durante el primer día y, después, periodos de hasta 30 días o cualquier fecha.
- Freelancer no facilita el país del cliente en su API pública, por lo que el filtro de país se desactiva al elegir exclusivamente esa plataforma.
- Los filtros avanzados activos se indican en el bloque principal aunque el panel esté plegado.
- Al pulsar «Limpiar todos los filtros» se restablecen también la búsqueda, favoritos, vistos, habilidades, rangos y ordenación.

## Requisitos

### Ejecución local

- Node.js 18 o posterior.
- Conexión a Internet para actualizar datos y tipos de cambio.
- Para Workana: OpenClaw con el navegador configurado **o** Chromium indicado mediante `CHROMIUM_PATH`.
- `jq` es opcional y solo se utiliza en algunos ejemplos de diagnóstico.

Instala la dependencia necesaria antes del primer inicio:

```bash
npm ci
```

### Ejecución con Docker

- Docker Engine con Docker Compose v2 (`docker compose`).

La imagen instala Chromium y no necesita OpenClaw para actualizar Workana. Fuera de Docker, Workana utiliza el navegador de OpenClaw cuando no se define `CHROMIUM_PATH`.

## Iniciar el panel

Desde la carpeta del proyecto:

```bash
npm start
```

Después se puede abrir:

```text
http://localhost:8081
```

El puerto puede modificarse mediante la variable `WORKANA_WEB_PORT`:

```bash
WORKANA_WEB_PORT=8090 node web/server.js
```

El servidor escucha en todas las interfaces de red. Limita el acceso con el cortafuegos o una red de confianza, ya que el panel no incluye autenticación.

### Directorio de datos

Por defecto, los JSON se crean en la raíz del proyecto. Para guardarlos en otra carpeta escribible, define `DATA_DIR` antes de iniciar el servidor y al ejecutar los extractores:

```bash
DATA_DIR=/ruta/a/mis-datos npm start
DATA_DIR=/ruta/a/mis-datos npm run refresh
```

El directorio debe existir y ser escribible. Esto resulta útil para separar el código de los datos personales en una instalación local.

### Servicio de usuario

En este equipo está configurado el servicio `workana-web.service` para iniciar el panel automáticamente:

```bash
systemctl --user status workana-web.service
systemctl --user restart workana-web.service
```

Aunque conserva ese nombre histórico, el servicio ejecuta el panel combinado de las tres plataformas.

## Ejecutar con Docker

El proyecto incluye `Dockerfile` y `docker-compose.yml`. La imagen instala Chromium para que la actualización de Workana funcione dentro del contenedor sin depender de OpenClaw. El Compose crea la imagen `proyectos-freelancer:latest` a partir del Dockerfile.

Construir e iniciar:

```bash
docker compose up -d --build
```

Abrir el panel (el puerto externo actual del Compose es `8084`):

```text
http://localhost:8081
```

El puerto `8081` del equipo debe estar libre. Para cambiarlo, modifica únicamente la parte izquierda de esta línea en `docker-compose.yml`:

```yaml
ports:
  - "8081:8081"
```

El puerto interno del contenedor sigue siendo `8081`. Si el servicio nativo usa el mismo puerto externo elegido, hay que detenerlo antes de iniciar el contenedor:

```bash
systemctl --user stop workana-web.service
```

Consultar estado, salud y registros:

```bash
docker compose ps
docker compose logs -f proyectos-freelancer
```

Ejecutar una actualización manual dentro del contenedor:

```bash
docker compose exec proyectos-freelancer npm run refresh:freelancer
docker compose exec proyectos-freelancer npm run refresh:workana
docker compose exec proyectos-freelancer npm run refresh:soyfreelancer
```

Detener el panel:

```bash
docker compose down
```

Los JSON se guardan en el volumen `proyectos_freelancer_data`. Reconstruir o eliminar el contenedor no borra proyectos vistos, favoritos, perfiles ni datos actualizados. El volumen se crea y administra por Docker; no es necesario crear carpetas ni copiar archivos a mano.

La imagen no incluye los JSON del entorno de desarrollo ni ninguna información personal. Un volumen nuevo comienza vacío y el panel mostrará cero proyectos hasta actualizar cada plataforma desde la interfaz o mediante los comandos anteriores.

Para ver la ubicación real del volumen:

```bash
docker volume inspect panel_local_freelancer_proyectos_freelancer_data
```

No se debe ejecutar `docker compose down -v` salvo que se quiera eliminar expresamente todo el volumen persistente. Para comprobar la configuración final antes de arrancar:

```bash
docker compose config
```

## Actualizar los proyectos

La forma habitual es pulsar el icono de actualización situado debajo del contador de cada plataforma.

También se pueden ejecutar los extractores desde la terminal:

```bash
node scrape_freelancer.js
node scrape_workana.js
node scrape_soyfreelancer.js
```

Para actualizar las tres fuentes en paralelo:

```bash
node refresh_all.js
```

Cada actualización crea primero un archivo temporal y sustituye el JSON anterior de forma atómica. Si la extracción falla antes de terminar, los datos válidos anteriores se conservan.

### Freelancer

Consulta la API pública de proyectos activos:

```text
https://www.freelancer.com/api/projects/0.1/projects/active/
```

- Descarga páginas de 100 proyectos.
- Limita la consulta a los primeros 5.000 registros accesibles porque la API pública repite páginas a partir de ese punto.
- Reintenta automáticamente cuando recibe límites temporales de peticiones.
- Mantiene el idioma original de cada proyecto para permitir filtrarlo en el panel.

### Workana

Lee los datos incluidos por Workana en sus páginas de resultados en español. En Docker utiliza Chromium mediante `puppeteer-core`; en ejecución local utiliza OpenClaw o el Chromium indicado con `CHROMIUM_PATH`.

- Recorre hasta 50 páginas.
- Utiliza el `slug` oficial del anuncio como `source_id` estable.
- Normaliza las fechas relativas, incluidas expresiones como «Ayer», «Hace instantes» o «Hace casi una hora».
- Si se utiliza OpenClaw, la ruta del ejecutable puede cambiarse con `OPENCLAW_BIN`:

```bash
OPENCLAW_BIN=/ruta/a/openclaw node scrape_workana.js
```

### SoyFreelancer

Consulta el índice público de búsqueda utilizado por el sitio y obtiene únicamente proyectos activos.

- Conserva el identificador público del anuncio como `source_id`.
- Normaliza países, categorías, habilidades, postulaciones y presupuesto.
- Los anuncios de esta fuente se marcan con idioma español.

## Conversión de moneda

Antes de guardar cada actualización, los presupuestos se convierten a euros con los tipos publicados por Frankfurter:

```text
https://api.frankfurter.dev/v1/latest?base=EUR
```

Los valores se redondean a euros enteros. Cada proyecto conserva:

- `budget`: importe visible convertido a euros.
- `budget_eur_min`: valor mínimo numérico.
- `budget_eur_max`: valor máximo numérico o `null` si el límite está abierto.
- `original_budget`: presupuesto tal como lo publicó la plataforma.

Si no se pueden consultar los tipos de cambio, el extractor falla antes de sustituir el archivo de datos anterior.

## Datos persistentes

Todos los datos se guardan dentro de la carpeta del proyecto:

| Archivo | Contenido |
| --- | --- |
| `freelancer_jobs.json` | Proyectos normalizados de Freelancer. |
| `workana_jobs.json` | Proyectos normalizados de Workana. |
| `soyfreelancer_jobs.json` | Proyectos normalizados de SoyFreelancer. |
| `seen_jobs.json` | Claves de proyectos marcados como vistos. |
| `favorite_jobs.json` | Claves de proyectos favoritos. |
| `search_profiles.json` | Perfiles de búsqueda guardados. |

Los estados utilizan una clave con el formato:

```text
Plataforma:source_id
```

Ejemplos:

```text
Freelancer:40677848
Workana:slug-oficial-del-proyecto
SoyFreelancer:identificador-publico
```

Las claves históricas pueden permanecer en los archivos de vistos o favoritos aunque el anuncio ya no aparezca en la actualización actual. Esto permite recuperar el estado si el proyecto vuelve a aparecer.

Con Docker, estos mismos archivos se guardan en `/data` dentro del volumen persistente, no dentro de la imagen. Por ello una instalación nueva no contiene proyectos ni información personal hasta que se realice la primera actualización.

## Estructura del proyecto

```text
panel_local_freelancer/
├── Dockerfile                  # Imagen de la aplicación
├── docker-compose.yml          # Ejecución con Docker
├── .dockerignore               # Excluye datos personales de la imagen
├── README.md
├── currency.js                 # Conversión y formato de presupuestos
├── storage.js                  # Escritura atómica de JSON
├── refresh_all.js              # Actualización conjunta
├── scrape_freelancer.js        # Extractor de Freelancer
├── scrape_workana.js           # Extractor de Workana
├── scrape_soyfreelancer.js     # Extractor de SoyFreelancer
├── *_jobs.json                 # Datos normalizados de cada fuente
├── seen_jobs.json              # Proyectos vistos
├── favorite_jobs.json          # Favoritos
├── search_profiles.json        # Perfiles de búsqueda
└── web/
    ├── server.js               # Servidor HTTP y API local
    ├── index.html              # Interfaz
    ├── app.js                  # Filtros, estado y renderizado
    ├── styles.css              # Diseño adaptable
    └── favicon.png
```

## API local

| Método | Ruta | Uso |
| --- | --- | --- |
| `GET` | `/api/jobs` | Devuelve los proyectos combinados y sus metadatos. |
| `POST` | `/api/jobs/seen` | Marca o desmarca un proyecto como visto. |
| `POST` | `/api/jobs/favorite` | Añade o elimina un favorito. |
| `GET` | `/api/search-profiles` | Devuelve los perfiles guardados. |
| `POST` | `/api/search-profiles/save` | Guarda o actualiza un perfil. |
| `POST` | `/api/search-profiles/delete` | Elimina un perfil. |
| `GET` | `/api/refresh-status` | Devuelve el estado de la actualización activa. |
| `POST` | `/api/refresh/:fuente` | Actualiza `freelancer`, `workana` o `soyfreelancer`. |

El servidor solo admite una actualización desde la API cada vez. Mientras una fuente se está actualizando, los demás botones permanecen desactivados.

## Comprobaciones y diagnóstico

Validar la sintaxis de los scripts:

```bash
for file in *.js web/*.js; do node --check "$file"; done
```

Validar los archivos JSON:

```bash
for file in *.json; do jq empty "$file"; done
```

Consultar el estado del servicio y la API:

```bash
systemctl --user status workana-web.service
curl http://localhost:8081/api/refresh-status
curl http://localhost:8081/api/jobs
```

Si se ejecuta mediante Docker con la configuración incluida, usa el puerto publicado `8084`:

```bash
curl http://localhost:8084/api/refresh-status
curl http://localhost:8084/api/jobs
```

Los archivos web se sirven con caché desactivada, por lo que los cambios deberían aparecer al recargar la página. Si el navegador mantiene el favicon anterior, se puede forzar la recarga con `Ctrl+F5`.

## Consideraciones

- Los tipos de cambio son aproximados y corresponden a la fecha indicada en cada archivo de datos.
- La disponibilidad y estructura de las fuentes externas puede cambiar sin previo aviso.
- La cantidad de proyectos varía en cada actualización.
- El panel está pensado para uso personal o dentro de una red de confianza; no incluye autenticación.
- Los anuncios y estados guardados pueden contener información personal o de trabajo. No compartas el volumen Docker ni los archivos JSON sin revisarlos antes.
- Conviene revisar las condiciones de uso de cada plataforma antes de redistribuir o publicar los datos recopilados.
