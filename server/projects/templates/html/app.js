let count = 0;
const button = document.getElementById("boton");
button.addEventListener("click", () => {
  count += 1;
  button.textContent = "Pulsado " + count + (count === 1 ? " vez" : " veces");
});
