import { db } from "../db/client.js";
import { organizationSettings } from "../db/schema.js";

/**
 * notifyEcommercePlatform
 * Fires an asynchronous background POST request to the e-commerce storefront.
 * This is executed in a fire-and-forget promise chain to prevent slowing down transaction checkout.
 * 
 * @param itemId Number ID of the modified item
 * @param action Event string like 'ITEM_SOLD'
 */
export function notifyEcommercePlatform(itemId: number, action: string) {
  Promise.resolve().then(async () => {
    try {
      const settings = db.select().from(organizationSettings).get();
      if (!settings || !settings.ecommerce_sync_url) {
        return;
      }

      const syncUrl = settings.ecommerce_sync_url.trim();
      const secret = settings.webhook_secret || "";

      if (!syncUrl) {
        return;
      }

      console.log(`Sending webhook to ${syncUrl} for item ${itemId} (action: ${action})...`);

      const response = await fetch(syncUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-webhook-secret": secret
        },
        body: JSON.stringify({
          event: action,
          itemId
        })
      });

      if (!response.ok) {
        console.warn(`Webhook storefront responded with non-2xx status: ${response.status}`);
      } else {
        console.log(`Webhook storefront sync completed successfully for item ${itemId}`);
      }
    } catch (error) {
      console.error(`E-commerce storefront webhook notification failed for item ${itemId}:`, error);
    }
  });
}
