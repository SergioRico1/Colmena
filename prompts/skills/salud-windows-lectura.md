---
name: Revisión de salud de Windows (solo lectura)
description: Úsala cuando la persona quiera saber si su ordenador Windows está al día y protegido (actualizaciones, cortafuegos, cifrado, copias, espacio) sin cambiar nada.
metadata:
  colmena:
    bot: bruno
    adaptada_de: "OpenClaw skills/healthcheck (MIT)"
---

# Revisión de salud de Windows (solo lectura)

Objetivo: describir cómo está el equipo y proponer mejoras por etapas, sin tocar nada.

Reglas:
- Solo comprobaciones de lectura. Nunca instales, borres, cambies ajustes, servicios, registro ni cortafuegos.
- Cada comando necesita el OK de la persona (`run_command` siempre pide aprobación). Si no tienes esa herramienta, pide a la persona que te pegue la salida o guíala paso a paso.
- Nunca muestres claves, contraseñas ni números de serie completos.

1. Contexto: pregunta lo que no sepas en una sola pregunta (`ask_user`): ¿ordenador personal o del trabajo?, ¿se usa fuera de casa?, ¿hay copia de seguridad?
2. Comprobaciones de lectura (pide permiso una vez y ejecútalas una a una):
   - `systeminfo` → versión de Windows y fecha de las últimas actualizaciones.
   - `netsh advfirewall show allprofiles state` → cortafuegos activo en cada perfil.
   - `manage-bde -status C:` → cifrado BitLocker (puede pedir permisos de administrador: si falla, dilo).
   - `wmic logicaldisk get caption,freespace,size` o el Explorador → espacio libre.
   Hecho cuando cada punto está comprobado o marcado «no se pudo comprobar».
3. Informe (`create_deliverable`, kind document, format md):
   - Estado actual en un párrafo.
   - Hallazgos: gravedad (alta, media, baja) + evidencia literal + por qué importa.
   - Plan por etapas, reversible, empezando por lo más fácil.
   - Lo que no se pudo comprobar.
4. Si la persona quiere aplicar algo, explica los pasos para que los haga ella o confirma cada acción por separado antes de hacerla.
