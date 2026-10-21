async (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({width: 1440, height: 1080});
  await page.goto('http://127.0.0.1:4317/connections/Connections.dc.html');
  await page.getByText('El servicio de conexiones no está disponible. Contacta con el administrador.', {exact: true}).waitFor();
  if (/Composio|Cambiar clave/.test(await page.locator('body').innerText())) throw Error('Internal engine exposed');
  if (await page.getByRole('button', {name: 'Conectar', exact: true}).count() !== 6) throw Error('Catalog page must retain six original cells');
  await page.screenshot({path: 'output/playwright/connections-real-server.png', fullPage: true});
  await page.getByRole('link', {name: 'Ver más apps', exact: true}).click();
  await page.getByText('Supabase', {exact: true}).waitFor();
  if (await page.getByRole('button', {name: 'Conectar', exact: true}).count() !== 1) throw Error('Next catalogue page failed');
  if (errors.length) throw Error(errors.join('\n'));
  return {passed: true, liveProviderConfigured: false, pageErrors: errors};
}
