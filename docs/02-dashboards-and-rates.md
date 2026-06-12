# 2. Dashboards & Daily Rates

[← Back to index](README.md) · [Next: Inventory →](03-inventory.md)

## Dashboards
Two dashboards are available in the left sidebar:

- **MIS Dashboard** (Admin/Manager only) — business analytics: today's sales, outstanding
  dues, stock value, top movers, and trend cards. Use this for an at-a-glance shop health check.
- **Dashboard** (all staff) — the operational screen combining the **Daily Rates** control bar
  (top) with the **live inventory table** (below). This is the screen counter staff use most.

## Daily Gold/Silver Rates & Live Rate Sync
Set here once each morning — these rates drive all billing prices. **(Admin only; staff see
rates read-only.)**

**Set rates manually**
1. Go to **Dashboard**.
2. In the **Daily Rates Control** bar, type today's **Gold 24K / 22K / 18K / Silver** rates.
3. Click **Save & Update Rates**. The **Last Synced** time updates.

**Sync live MCX rates (optional)**
1. Click **Rate API Key**, paste your gold-rate API key, and save. The status dot turns **green**.
2. Click **Sync Live MCX Rates** — the app fetches current market rates automatically.

> The API key is stored per-shop inside the app (not an environment variable). Enter it once.
