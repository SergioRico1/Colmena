# Conectar Gmail con contraseña de aplicación

Con este camino tus bots usan tu Gmail (o el de tu Google Workspace) **sin que Colmena registre nada
con Google**: Colmena entra en tu buzón por IMAP (leer) y SMTP (enviar) con una contraseña de
aplicación que creas tú y que puedes revocar cuando quieras. Sirve igual para iCloud, Yahoo, Fastmail
y casi cualquier proveedor de correo.

Lo que pueden hacer tus bots:

- **Sin preguntarte:** buscar correos, leer conversaciones, ver carpetas y etiquetas.
- **Con tu OK** (o sin preguntar si se lo permites en Autonomía y permisos): preparar borradores
  (quedan en tu carpeta Borradores, no salen de tu cuenta), mover, etiquetar y marcar como leído.
- **Siempre con tu OK, revisando el correo entero:** enviar. Puedes cambiar destinatarios, asunto y
  texto antes de que salga. Nada puede saltarse esta línea roja.

## Lo que necesitas

- Una cuenta de Gmail o de Google Workspace con la **verificación en dos pasos** activada.
- En Google Workspace: que quien administra no haya desactivado las contraseñas de aplicación.

Google no ofrece contraseñas de aplicación en estas cuentas
(https://support.google.com/accounts/answer/185833):

- cuentas con la verificación en dos pasos **solo con llaves de seguridad**;
- cuentas con **Protección Avanzada**;
- cuentas de trabajo, de centro educativo u otra organización donde la organización no las permite.

En esos casos conecta Gmail con Composio (Ajustes › Apps › Marketplace › Gmail).

## Paso a paso

1. Entra en https://myaccount.google.com/security y comprueba que la **Verificación en dos pasos**
   está activada. Si no lo está, actívala.
2. Abre https://myaccount.google.com/apppasswords.
3. Escribe un nombre que reconozcas, por ejemplo «Colmena», y pulsa **Crear**.
4. Google te enseña una contraseña de 16 letras en cuatro grupos. Cópiala (los espacios dan igual).
   No la vuelve a enseñar: si la pierdes, crea otra.
5. En Colmena: **Ajustes › Apps y carpetas › Marketplace › Correo (IMAP/SMTP)**.
6. Escribe tu dirección y pega la contraseña de aplicación. El proveedor se detecta solo
   (gmail.com, googlemail.com). Si tu correo de Google Workspace usa el dominio de tu empresa, elige
   **«Gmail o Google Workspace»** en Proveedor.
7. Pulsa **Probar y conectar**. Colmena entra en tu buzón y comprueba que podría enviar, sin enviar
   nada. Si algo falla, te dice qué en una frase.

Servidores que usa Colmena con Gmail (https://developers.google.com/workspace/gmail/imap/imap-smtp):
`imap.gmail.com:993` (TLS) y `smtp.gmail.com:465` (TLS).

## Dónde se guarda

- **Escritorio:** cifrada con el almacén de Windows (DPAPI) de tu usuario, en tu ordenador.
- **Nube (app.colmena.team):** cifrada en el almacén de tu empresa, con una clave propia de cada
  empresa, y **solo tuya**: nadie más del equipo la ve ni sus bots la usan.

Colmena nunca la escribe en registros ni la enseña de vuelta. Para quitarla: **Desconectar** en la
página de la app en Colmena, y revócala en https://myaccount.google.com/apppasswords.

## Otros proveedores

| Proveedor | IMAP | SMTP | Contraseña de aplicación |
| --- | --- | --- | --- |
| iCloud | imap.mail.me.com:993 | smtp.mail.me.com:587 (STARTTLS) | https://support.apple.com/102654 |
| Yahoo | imap.mail.yahoo.com:993 | smtp.mail.yahoo.com:465 | https://help.yahoo.com/kb/SLN15241.html |
| Fastmail | imap.fastmail.com:993 | smtp.fastmail.com:465 | https://www.fastmail.help/hc/en-us/articles/360058752854 |
| Otro | el de tu proveedor | el de tu proveedor (465 o 587) | según tu proveedor |

El puerto 25 no se puede usar (la nube de Colmena lo tiene bloqueado, como casi todos los servicios).

**Outlook, Hotmail y Microsoft 365 no funcionan con contraseña.** Microsoft desactivó la
autenticación básica por IMAP en Exchange Online y no se puede volver a activar, y Outlook.com exige
OAuth (https://learn.microsoft.com/en-us/exchange/clients-and-mobile-in-exchange-online/deprecation-of-basic-authentication-exchange-online,
https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-for-outlook-com-d088b986-291d-42b8-9564-9c414e2aa040).
Conéctalos con Composio.

## Si algo falla

| Mensaje | Qué hacer |
| --- | --- |
| «El correo o la contraseña de aplicación no son correctos.» | Copia la contraseña otra vez; comprueba que es una contraseña de aplicación, no la de tu cuenta. |
| «El servidor de envío no aceptó la contraseña de aplicación.» | Igual que arriba; en Workspace, pregunta si las contraseñas de aplicación están permitidas. |
| «No se pudo conectar con …» | Revisa servidor y puerto; prueba 465 o 587 para el envío. |
| «Outlook, Hotmail y Microsoft 365 ya no dejan entrar con contraseña…» | Usa Composio para Outlook. |

Google dice que las contraseñas de aplicación «no se recomiendan» y que son innecesarias en la
mayoría de los casos; hoy siguen funcionando y no hay fecha de retirada publicada. Si Google las
retira, este camino dejará de funcionar y tendrás que usar Composio.
