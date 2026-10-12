'use client';
import {useEffect,useState, type FormEvent} from 'react';
import {browserClient} from '../lib/supabase/browser';
import {supabaseConfig} from '../lib/supabase/config';
type Mode = 'inloggen'|'registreren'|'herstellen'|'reset';
export function AuthPanel({mode}:{mode:Mode}) {
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const configured = !!supabaseConfig();
  useEffect(()=>{setMessage('');setError(new URLSearchParams(location.search).has('auth_error')?'Automatisch inloggen is niet gelukt. Je e-mailadres kan al bevestigd zijn. Probeer hieronder in te loggen; lukt dat niet, vraag een nieuwe bevestigingsmail aan.':'');},[mode]);
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault(); setError(''); setMessage('');setBusy(true);
    const form=new FormData(event.currentTarget);
    const email=String(form.get('email')||'').trim();
    const password=String(form.get('password')||'');
    const callback=new URL('/auth/callback',location.origin);
    try{
      const client=browserClient();
      if(mode==='registreren'){
        const kvk=String(form.get('kvk')||'').trim();
        if(!/^\d{8}$/.test(kvk))throw new Error('Vul een KvK-nummer van precies acht cijfers in.');
        const {error}=await client.auth.signUp({email,password,options:{emailRedirectTo:callback.toString(),data:{first_name:String(form.get('first_name')||'').trim(),name_prefix:String(form.get('name_prefix')||'').trim(),last_name:String(form.get('last_name')||'').trim(),requested_company_name:String(form.get('company')||'').trim(),requested_kvk:kvk}}});
        if(error)throw new Error('Aanmelden is niet gelukt. Controleer je gegevens en probeer later opnieuw.');
        // An existing account must not be disclosed; never treat signUp as approval.
        setMessage('Als de aanvraag kan worden verwerkt, ontvang je een bevestigingsmail. Open de link in dezelfde browser. Na e-mailbevestiging wordt je aanvraag beoordeeld.');
      }else if(mode==='inloggen'){
        const {error}=await client.auth.signInWithPassword({email,password});
        if(error)throw new Error('Inloggen is niet gelukt. Controleer je gegevens en of je e-mailadres is bevestigd.');
        location.hash='account';
      }else if(mode==='herstellen'){
        callback.searchParams.set('next','/reset-password');
        const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:callback.toString()});
        if(error)throw new Error('De herstelmail kan nu niet worden aangevraagd. Probeer later opnieuw.');
        setMessage('Als dit e-mailadres bekend is, ontvang je een herstelmail. Open de link in dezelfde browser.');
      }else{
        const {data:{user},error:authError}=await client.auth.getUser();
        if(authError||!user)throw new Error('Open eerst de link uit je herstelmail.');
        const {error}=await client.auth.updateUser({password});
        if(error)throw new Error('Het wachtwoord kon niet worden gewijzigd. Probeer een ander wachtwoord of vraag een nieuwe herstelmail aan.');
        await client.auth.signOut();location.href='/#inloggen';
      }
    }catch(e){setError(e instanceof Error?e.message:'De accountdienst is tijdelijk niet bereikbaar.');}
    finally{setBusy(false)}
  }
  async function resend(){
    const input=document.getElementById('email') as HTMLInputElement|null;
    if(!input||!input.value||!input.reportValidity())return;
    setBusy(true);setError('');setMessage('');
    try{
      const {error}=await browserClient().auth.resend({type:'signup',email:input.value.trim(),options:{emailRedirectTo:new URL('/auth/callback',location.origin).toString()}});
      if(error)throw Error();
      setMessage('Als je account op bevestiging wacht, ontvang je een nieuwe bevestigingsmail.');
    }catch{setError('De bevestigingsmail kan nu niet worden aangevraagd. Probeer later opnieuw.');}finally{setBusy(false)}
  }
  return <section className="auth"><div className="auth-art"><div className="eyebrow">Een eigen blik op rechtspraak</div><img src="/previews/drawing-6.jpg" alt="Rechtbanktekening door Nicole van den Hout"/><h2>Het juiste beeld.<br/>Voor jouw verhaal.</h2></div><div className="auth-form">
    <div className="auth-tabs"><a href="/#inloggen" className={mode==='inloggen'?'active':''}>Inloggen</a><a href="/#registreren" className={mode==='registreren'?'active':''}>Toegang aanvragen</a></div>
    <h2>{mode==='registreren'?'Toegang voor jouw redactie.':mode==='herstellen'?'Wachtwoord herstellen':mode==='reset'?'Nieuw wachtwoord':'Goed je weer te zien.'}</h2>
    <p>{mode==='registreren'?'Meld je persoonlijk aan namens je bedrijf. We controleren je aanvraag voordat je toegang krijgt.':'Log in met je persoonlijke account.'}</p>
    {!configured&&<p className="notice">De accountdienst is nog niet ingesteld.</p>}
    <form onSubmit={submit}>
      {mode==='registreren'&&<><div className="field"><label htmlFor="first_name">Voornaam</label><input id="first_name" name="first_name" required maxLength={80} autoComplete="given-name"/></div><div className="field"><label htmlFor="name_prefix">Tussenvoegsel · optioneel</label><input id="name_prefix" name="name_prefix" maxLength={40}/></div><div className="field"><label htmlFor="last_name">Achternaam</label><input id="last_name" name="last_name" required maxLength={100} autoComplete="family-name"/></div><div className="field"><label htmlFor="company">Bedrijfsnaam</label><input id="company" name="company" required maxLength={200} autoComplete="organization"/></div><div className="field"><label htmlFor="kvk">KvK-nummer</label><input id="kvk" name="kvk" required pattern="[0-9]{8}" minLength={8} maxLength={8} inputMode="numeric" aria-describedby="kvk-help"/><p id="kvk-help" className="tiny">Acht cijfers. We controleren de bedrijfsnaam en of je namens dit bedrijf toegang mag krijgen.</p></div></>}
      {mode!=='reset'&&<div className="field"><label htmlFor="email">E-mailadres</label><input id="email" name="email" required type="email" autoComplete="email"/></div>}
      {mode!=='herstellen'&&<div className="field"><label htmlFor="password">Wachtwoord{mode!=='inloggen'?' · minimaal 12 tekens':''}</label><input id="password" name="password" required type="password" minLength={mode==='inloggen'?1:12} maxLength={128} autoComplete={mode==='inloggen'?'current-password':'new-password'}/></div>}
      <button className="primary full" disabled={busy||!configured}>{busy?'Even geduld…':mode==='registreren'?'Toegang aanvragen':mode==='herstellen'?'Herstelmail aanvragen':mode==='reset'?'Wachtwoord opslaan':'Inloggen'}</button>
    </form>
    {error&&<p role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
    {mode==='inloggen'&&<><p><a className="textlink" href="/#herstellen">Wachtwoord vergeten?</a></p><button className="textlink" disabled={busy||!configured} onClick={resend}>Bevestigingsmail opnieuw aanvragen</button></>}
  </div></section>
}
