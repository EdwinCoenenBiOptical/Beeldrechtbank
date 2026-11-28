import {runInvoiceAutomation} from '../../lib/moneybird/automation-worker.mjs';
export const config={schedule:'*/5 * * * *'};
export default async()=>{
 try{console.info('invoice-automation',await runInvoiceAutomation());}
 catch{console.error('invoice-automation: configuration or database unavailable; inspect Facturen/settings');}
};
