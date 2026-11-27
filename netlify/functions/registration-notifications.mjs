import { dispatchRegistrations } from '../../lib/notifications/worker.mjs';
export const config = { schedule: '*/5 * * * *' };
export default async () => {
  try {
    const result=await dispatchRegistrations();
    console.info('registration-notifications',result);
  } catch {
    // No names, addresses, credentials or provider responses in hosting logs.
    console.error('registration-notifications: worker unavailable; inspect queue/configuration');
  }
};
