"""Re-download BiteBuddy's menu photos from Unsplash (free Unsplash License).

Each menu item has its own photo. Run from the project root:
    python download_images.py           # only fetches missing files
    python download_images.py --force   # re-downloads everything

Images are saved at 960x720 (4:3) to match the card layout.
"""
import os
import sys
import urllib.request

BASE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app', 'static', 'images')
os.makedirs(BASE_DIR, exist_ok=True)

# filename -> Unsplash CDN photo id
IMAGES = {
    # Categories
    'cat_burgers.jpg': '1568901346375-23c9450c58cd',
    'cat_chicken.jpg': '1764018292116-003fd7d1a0ba',
    'cat_pizza.jpg': '1513104890138-7c749659a591',
    'cat_wraps.jpg': '1626700051175-6818013e1d4f',
    'default_cat.jpg': '1555939594-58d7cb561ad1',
    'default_food.jpg': '1546069901-ba9599a7e63c',
    # Burgers
    'item_smash.jpg': '1598182198871-d3f4ab4fd181',
    'item_zinger.jpg': '1692737349870-e3bfc704ebf9',
    'item_bbq.jpg': '1586190848861-99aa4a171e90',
    'item_cheese.jpg': '1586816001966-79b736744398',
    # Fried chicken
    'item_2pc.jpg': '1626082927389-6cd097cdc6ec',
    'item_5pc.jpg': '1586793783658-261cddf883ef',
    'item_10pc.jpg': '1426869981800-95ebf51ce900',
    # Pizza
    'item_pepperoni.jpg': '1628840042765-356cda07504e',
    'item_margherita.jpg': '1574071318508-1cdbab80d002',
    # Wraps & rolls
    'item_shawarma.jpg': '1529006557810-274b9b2fc783',
    'item_wrap.jpg': '1773620494884-940e0db95e46',
    'item_seekh.jpg': '1676300187013-7540d4e9440d',
    # Sides
    'item_fries.jpg': '1576107232684-1279f390859f',
    'item_coleslaw.jpg': '1781019450251-26e5ef42e089',
    'item_onion.jpg': '1639024471283-03518883512d',
    'item_corn.jpg': '1634467524884-897d0af5e104',
    # Beverages
    'item_cola.jpg': '1622483767028-3f66f32aef97',
    'item_mango.jpg': '1623065422902-30a2d299bbe4',
    'item_choco.jpg': '1572490122747-3968b75cc699',
    'item_lemon.jpg': '1513558161293-cdaf765ed2fd',
    # Desserts
    'item_lava.jpg': '1617305855058-336d24456869',
    'item_sundae.jpg': '1773620492666-86b9ab584ea4',
    'item_brownie.jpg': '1624353365286-3f8d62daad51',
}
# Large hero/panel photos (fetched at their own sizes): hero_main.jpg 1568901346375-23c9450c58cd (1400x1600),
# hero_pizza.jpg 1513104890138-7c749659a591 (900x900), auth_panel.jpg 1555939594-58d7cb561ad1 (1200x1500)
# Not on Unsplash (custom shots kept in the repo): cat_beverages, cat_sides, cat_desserts,
# item_supreme, item_wings


def main(force=False):
    for filename, photo_id in IMAGES.items():
        path = os.path.join(BASE_DIR, filename)
        if os.path.exists(path) and not force:
            continue
        url = f'https://images.unsplash.com/photo-{photo_id}?w=960&h=720&fit=crop&q=82&fm=jpg'
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'BiteBuddy-image-sync'})
            with urllib.request.urlopen(req, timeout=60) as response, open(path, 'wb') as out:
                out.write(response.read())
            print(f'downloaded {filename}')
        except Exception as exc:  # noqa: BLE001
            print(f'failed {filename}: {exc}')


if __name__ == '__main__':
    main(force='--force' in sys.argv)
