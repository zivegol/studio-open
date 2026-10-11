// The Sister tab also has a Password label: scope every field to Entratel.
export async function fillEntratelCredentials(page,credentials){
  const panel=page.locator('#tab-4');
  await panel.waitFor({state:'visible'});
  await panel.getByLabel('Codice fiscale/Nome utente:',{exact:true}).fill(credentials.username);
  await panel.getByLabel('Password:',{exact:true}).fill(credentials.password);
  await panel.getByLabel('PIN:',{exact:true}).fill(credentials.pin);
  return panel.getByRole('button',{name:'Accedi',exact:true});
}
