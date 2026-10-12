export function confirmationToken(fragment){const value=new URLSearchParams(fragment.replace(/^#/, '')).get('token_hash');return value&&/^[a-f0-9]{64}$/i.test(value)?value:null}
