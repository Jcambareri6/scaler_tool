# Worker de render: guía de instalación y operación

Cómo poner en producción el worker de render (`src/worker.ts`) en un servidor dedicado (Hetzner AX42 u otro) y pasar la API de Render al modo cola. La arquitectura y el porqué están en [`../migracion-worker-render.md`](../migracion-worker-render.md).

```
Frontend ──► API en Render (EXECUTION_MODE=queue) ──► Supabase (tabla jobs = cola)
                                                              ▲
                                            Worker (Docker) ──┘  en el servidor dedicado
```

---

## 0. Qué necesitás antes de empezar

- El servidor contratado con **Ubuntu 24.04** y tu clave SSH cargada.
- Acceso al dashboard de **Supabase** (SQL Editor) y de **Render**.
- `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`: los mismos que ya tiene la API en Render.

---

## 1. Migración de Supabase (una sola vez)

1. Supabase → **SQL Editor** → New query.
2. Pegá el contenido de `supabase/migrations/20260925000000_job_queue.sql` y ejecutalo.
3. Qué hace:
   - Agrega columnas **nuevas** a `jobs`. No toca las que ya existen y **no cambia nada** mientras la API siga en `EXECUTION_MODE=inline`.
   - Crea las funciones `claim_next_job` y `requeue_stale_jobs`, solo ejecutables con la service-role key.

Se puede correr más de una vez sin romper nada.

---

## 2. Preparar el servidor

Conectate como root: `ssh root@IP_DEL_SERVIDOR`.

```bash
# Actualizar el sistema
apt update && apt upgrade -y

# Usuario sin privilegios para operar el worker
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh

# SSH solo con clave (sin password) y sin login de root
sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
systemctl restart ssh

# Firewall: todo lo entrante cerrado salvo SSH. El worker no expone ningún
# puerto: solo sale a internet (Supabase, APIs, R2/Cloudinary).
apt install -y ufw
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw --force enable

# Actualizaciones de seguridad automáticas
apt install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# Docker (script oficial) + permiso para el usuario deploy
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
systemctl enable docker
```

**Antes de cerrar la sesión de root**, abrí otra terminal y confirmá que `ssh deploy@IP_DEL_SERVIDOR` funciona.

---

## 3. Bajar el código

Como `deploy`: `ssh deploy@IP_DEL_SERVIDOR`.

El repo es privado. La forma más simple y segura es una **deploy key de solo lectura**:

```bash
ssh-keygen -t ed25519 -C "render-worker" -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

1. Copiá esa clave pública.
2. GitHub → repo `scaler_tool` → **Settings → Deploy keys → Add deploy key**. Pegala y dejá **sin** tildar "Allow write access".
3. Clonar:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
EOF
git clone git@github.com:Jcambareri6/scaler_tool.git
cd scaler_tool
git checkout migracion_worker_render   # o master, una vez mergeado
cd backend
```

---

## 4. Configurar y levantar el worker

```bash
cp .env.worker.example .env.worker
nano .env.worker        # completar SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY y WORKER_ID
chmod 600 .env.worker

docker compose -f docker-compose.worker.yml up -d --build
docker compose -f docker-compose.worker.yml logs -f
```

Tenés que ver algo así (y después nada, porque no hay trabajos en cola todavía):

```
[worker ax42-1] arrancando (render=2, pre_render=3, WORK_DIR=/data/work)
```

`Ctrl+C` sale de los logs y el worker sigue corriendo.

Los valores sugeridos de `.env.worker.example` están pensados para un AX42 (8 núcleos, 64 GB). Cada variable está explicada en el mismo archivo.

---

## 5. Pasar la API a modo cola

1. Render → servicio `scaler-tool-backend` → **Environment**. Agregá `EXECUTION_MODE` = `queue` y guardá. Render reinicia el servicio solo.
2. Desde la app, generá un video de prueba (idealmente uno real de ~25 min con ~200 clips).
3. Mirá los logs del worker:

```
[worker ax42-1] tomo job … (pre_render, intento 1/1, …)
[worker ax42-1] job … (pre_render) listo en …s
… (aprobás el stock en la UI)
[worker ax42-1] tomo job … (render, intento 1/3, …)
[render_video] corriendo ffmpeg (tanda 1/…)
[worker ax42-1] job … (render) listo en …s
```

4. La UI se actualiza sola, igual que antes (Realtime sobre la fila del job).

### Recién cuando todo funcione (recomendado: ~1 semana)
- Bajá el plan del servicio en Render a **Starter**.
- En `EXECUTION_MODE=queue`, la API ya no corre ffmpeg pesado. Solo quedan usos livianos de audio: el audio que sube el usuario, medir duraciones y el preview de voces.
- Hay una excepción a mirar: la pestaña Audio puede generar la voz completa directo desde la API (`/tools/generate_voice/execute`). Con guiones muy largos, esa generación corre en la API. Si ves errores de memoria en Render ahí, avisá y se pasa también a la cola.

---

## 6. Operación diaria

| Qué | Comando (en `~/scaler_tool/backend`) |
|---|---|
| Ver logs en vivo | `docker compose -f docker-compose.worker.yml logs -f` |
| Estado | `docker compose -f docker-compose.worker.yml ps` |
| Uso de CPU/RAM | `docker stats` |
| Espacio en disco | `df -h` y `docker system df` |
| Reiniciar | `docker compose -f docker-compose.worker.yml restart` |

### Actualizar el código
```bash
cd ~/scaler_tool && git pull
cd backend && docker compose -f docker-compose.worker.yml up -d --build
```
El worker deja de tomar trabajos nuevos, **espera los renders en curso** (hasta 14 min) y recién ahí se reinicia con el código nuevo. Si algún render quedó a medias, lo retoma solo al volver.

### Ver la cola desde Supabase (SQL Editor)
```sql
-- Pendientes y en curso
select id, queue, queue_state, status, progress, attempts, claimed_by, created_at
from jobs where queue_state in ('pending', 'claimed') order by created_at;

-- Últimos fallidos
select id, queue, error, finished_at from jobs
where queue_state = 'failed' order by finished_at desc limit 20;
```

---

## 7. Qué pasa cuando algo falla

| Situación | Qué hace el sistema |
|---|---|
| Hay más videos que capacidad | Esperan en la cola (`QUEUED` o `RENDERING`) y se procesan en orden. No se pierde nada |
| Un render falla (descarga caída, error temporal) | Se reintenta solo, hasta `RENDER_MAX_ATTEMPTS` (3), con espera creciente. Si falla las 3 veces: `FAILED` con el error visible en la UI |
| Un pre-render falla | `FAILED` sin reintento automático (repetirlo cobra de nuevo TTS, Whisper y video IA). El usuario lo relanza desde la UI |
| El worker o el servidor se reinician a mitad de un render | Al volver, el worker retoma sus jobs a medias y borra los temporales viejos |
| El servidor muere del todo | Los jobs quedan en la cola. Si hay otro worker, los toma a los ~3 min. Si no, se procesan cuando vuelva |

---

## 8. Volver atrás

En Render: `EXECUTION_MODE` = `inline`. La API vuelve a correr todo como antes, en segundos y sin redeploy.

⚠️ Esto solo funciona mientras Render siga en un plan con RAM suficiente. Por eso no conviene bajar el plan hasta que el worker esté probado.

---

## 9. Sumar capacidad

- **No** agregues más copias del contenedor en el mismo servidor: comparten los mismos núcleos y no se renderizan más videos por hora.
- **Sí** agregá otro servidor: repetí los pasos 2 a 4 en la máquina nueva con **otro `WORKER_ID`** (por ejemplo `ax42-2`). Los dos toman de la misma cola sin pisarse y la capacidad se duplica. No hay que tocar código, la API ni el frontend.
- Para picos puntuales, un servidor de **Hetzner Cloud por hora** con los mismos pasos, que se borra cuando baja la demanda.
