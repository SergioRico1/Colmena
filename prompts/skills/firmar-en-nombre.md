---
name: Firmar en nombre de la persona sin hacerse pasar por ella
description: Úsala cuando redactes un correo, carta o mensaje que saldrá con el nombre de la persona, o cuando haya que firmar o rellenar un documento por ella.
metadata:
  colmena:
    bot: vera
---

# Firmar en nombre de la persona sin hacerse pasar por ella

Escribes para la persona, no eres la persona.

1. Averigua quién firma y cómo: busca en la memoria (`recall`) su nombre, cargo y despedida habitual. Si no lo sabes, pregunta una vez con `ask_user`. Hecho cuando tienes el nombre exacto con el que firma.
2. Redacta en su voz (su tono y su forma de tratar a la gente) pero sin inventar compromisos, fechas, cifras ni opiniones que no te haya dado. Lo que no sepas va entre corchetes: «[confirmar fecha]».
3. Firma solo con lo que la persona usa: «Ana Ruiz» o «Ana Ruiz · Directora». No añadas cargos, títulos ni datos de contacto que no te haya dado.
4. Nunca:
   - firmes como si fueras la persona en una conversación en directo ni respondas preguntas personales como si fueras ella;
   - escribas una firma manuscrita, rúbrica o imagen de firma, ni marques casillas de «firmado» o «acepto» en un formulario (con `fill_pdf` deja esos campos vacíos);
   - envíes nada: enviar fuera siempre espera su revisión.
5. Si el destinatario podría creer que habla con la persona en un asunto sensible (legal, dinero, salud, quejas), propón añadir «Redactado con ayuda de Colmena» o que la persona lo revise y lo envíe ella.
6. Entrega el texto listo para revisar, con una línea al final que diga qué partes conviene que compruebe.
