"""Build swiss-foods.js for ProteinMaxx from the Swiss Food Composition Database.

Download both Excel files from https://naehrwertdaten.ch/en/downloads/ and run:
    python tools/build_swiss_data.py Swiss_food_composition_database.xlsx Schweizer_Nahrwertdatenbank.xlsx

Source: Swiss Food Composition Database, Federal Food Safety and Veterinary Office (FSVO).
Diet, gluten, protein-quality and portion fields are derived here by rules, not by the FSVO.
"""
import json, re, sys, zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
      "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}


def read_first_sheet(path):
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    wb = ET.fromstring(z.read("xl/workbook.xml"))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    first = wb.find("m:sheets", NS)[0]
    target = rels[first.get("{%s}id" % NS["r"])].lstrip("/")
    target = target if target.startswith("xl/") else "xl/" + target
    rows = []
    for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
        vals = {}
        for c in row.findall("m:c", NS):
            col = 0
            for ch in re.match(r"[A-Z]+", c.get("r")).group(0):
                col = col * 26 + ord(ch) - 64
            v = c.find("m:v", NS)
            if c.get("t") == "s" and v is not None:
                vals[col - 1] = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                vals[col - 1] = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
            else:
                vals[col - 1] = v.text if v is not None else None
        if vals:
            rows.append([vals.get(i) for i in range(max(vals) + 1)])
    return rows


def num(v):
    """Parse FSVO cell values: 'tr.' -> 0, '<0.5' -> 0, 'n.d.' -> None."""
    if v is None:
        return None
    s = str(v).strip()
    if s in ("n.d.", "", "-"):
        return None
    if s == "tr." or s.startswith("<"):
        return 0.0
    try:
        return float(s)
    except ValueError:
        return None


def has(name, words):
    return any(re.search(r"\b" + w, name) for w in words)


PORK = ["pork", "ham\\b", "bacon", "salami", "lard", "coppa", "cotechino", "mortadella", "cervelat", "luganighe",
        "landj", "sch.blig", "schweins", "cordon bleu", "carbonara", "luncheon", "lyoner", "bierwurst", "pantli",
        "minipic", "cabbage sausage", "black pudding", "liver sausage", "cotto", "hot dog", "gelatin", "fruit gum",
        "jelly", "marshmallow", "wienerli", "frankfurter", "chorizo", "prosciutto", "speck", "cold cuts", "hawaii",
        "croque", "cured meat", "pastry with meat", "tongue sausage", "bratwurst"]
MEAT = ["beef", "veal", "lamb", "mutton", "meat", "chicken", "turkey", "poultry", "duck", "goose", "horse", "deer",
        "venison", "hare", "rabbit", "goat", "game", "liver", "burger", "kebab", "bolognese", "lasagne", "sausage",
        "escalope", "chop\\b", "ragout", "goulash", "chili con carne", "bouillon, meat", "bresaola", "capuns",
        "tartare", "cannelloni filled with meat", "ostrich", "kangaroo", "wild boar", "bouillon, poultry", "nugget",
        "piccata"]
FISH = ["fish", "salmon", "tuna", "trout", "cod\\b", "herring", "sardine", "anchov", "mackerel", "perch", "pike",
        "pangasius", "plaice", "sole\\b", "hake", "pollock", "saithe", "char\\b", "whitefish", "redfish", "sushi",
        "caviar", "tilapia", "zander", "halibut", "sea bass", "sea bream", "monkfish", "eel"]
SHELL = ["shrimp", "prawn", "mussel", "oyster", "crab", "lobster", "squid", "octopus", "scallop", "seafood", "calamar"]
DAIRY = ["milk", "chees", "cream", "butter", "yog", "quark", "curd", "mozzarella", "parmesan", "ricotta", "mascarpone",
         "gratin", "fondue", "raclette", "pizza", "b.chamel", "chocolate", "ice cream", "porridge", "risotto",
         "macaroni from the alps", "kefir", "whey", "cappuccino", "latte", "tiramisu", "panna cotta", "rösti", "ziger"]
EGG = ["egg", "mayonnaise", "omelette", "quiche", "meringue", "pancake", "cr.pe", "spätzli", "sp.tzli", "custard",
       "french toast", "noodle", "biscuit", "cake", "sponge", "waffle", "mycoprotein", "vegetarian"]
GLUTEN = ["wheat", "spelt", "rye", "barley", "bread", "pasta", "noodle", "spaghetti", "macaroni", "couscous",
          "bulgur", "semolina", "pizza", "cake", "biscuit", "cookie", "pastry", "croissant", "sandwich", "breaded",
          "cordon bleu", "nugget", "cr.pe", "pancake", "waffle", "wafer", "cracker", "rusk", "pretzel", "seitan",
          "dumpling", "sp.tzli", "gnocchi", "lasagne", "ravioli", "tortellini", "cannelloni", "malt", "crouton",
          "burger", "kebab", "wrap", "tortilla", "quiche", "pie\\b", "tart", "flour omelette", "pita", "zwieback",
          "pastry", "dough", "toast", "hot dog", "capuns", "bami", "brioche", "gugelhopf", "plait", "zopf",
          "baguette", "roll", "flour", "graham", "bun\\b", "cereal", "flakes", "bran", "germ", "grünkern", "farro",
          "beer", "muesli", "müesli", "porridge", "oat", "piccata", "french toast", "escalope.*breaded"]
GLUTEN_FREE_FLOURS = ["rice flour", "corn", "maize", "potato", "chickpea", "buckwheat", "almond", "chestnut",
                      "millet", "quinoa", "amaranth", "teff", "tapioca", "coconut flour", "soy", "starch", "gluten-free",
                      "gluten free"]
MAYBE_GLUTEN = ["oat", "muesli", "müesli", "porridge", "sauce", "soup", "bouillon", "sausage", "cold cuts", "dressing",
                "chocolate", "ice cream", "cured", "luncheon", "lyoner", "cervelat", "wienerli", "mortadella",
                "meat loaf", "nugget", "spread", "stock", "pudding", "dessert"]

PURE_PLANT_SUBS = {"Pulses", "Fresh vegetables", "Fresh fruit", "Dried fruit", "Mushrooms", "Herbs", "Sprouts and shoots",
                   "Dried vegetables", "Frozen vegetables", "Oils", "Rice", "Corn", "Flour and starch",
                   "Potatoes and other starchy tubers", "Plant based drinks", "Plant based protein foods",
                   "Substitutes for meat, meat products, fish or egg", "Other dairy substitutes", "Fruit juices",
                   "Flakes, bran and germs", "Salted nuts, seeds and kernels"}


def group_of(main, sub, name):
    if main == "Meat and offal":
        return "Poultry" if sub == "Poultry" else "Meat"
    if main == "Sausages and cold meats":
        return "Sausages & cold cuts"
    if main == "Fish":
        return "Fish & seafood"
    if main == "Eggs":
        return "Eggs"
    if main == "Milk and dairy products":
        if sub in ("Hard cheese", "Soft cheese", "Cheese products"):
            return "Cheese"
        if sub == "Fresh cheese and curds":
            return "Quark & fresh cheese"
        return "Milk & yoghurt"
    if main.startswith("Plant based"):
        return "Dairy alternatives" if sub in ("Plant based drinks", "Other dairy substitutes") else "Plant proteins"
    if sub == "Pulses":
        return "Beans & lentils"
    if main.startswith("Nuts") or sub == "Salted nuts, seeds and kernels":
        return "Nuts & seeds"
    if main.startswith("Bread") or main.startswith("Cereal products"):
        return "Vegetables" if sub == "Potatoes and other starchy tubers" else "Grains & bread"
    if main == "Vegetables":
        return "Vegetables"
    if main == "Fruit":
        return "Fruit"
    if main == "Prepared dishes":
        return "Prepared dishes"
    if main in ("Sweets", "Savoury snacks"):
        return "Sweets & snacks"
    if main == "Fats and oils" or sub in ("Sauces", "Spreads"):
        return "Fats, sauces & spreads"
    if main == "Non-alcoholic beverages":
        return "Drinks"
    if "Yeast" in sub or main == "Special foods":
        return "Plant proteins"
    return "Other"


def source_of(main, sub, name):
    """Return (src, composite, pork_maybe). src: meat|pork|poultry|fish|shellfish|egg|dairy|plant."""
    composite = main in ("Prepared dishes", "Sweets", "Savoury snacks", "Bread, flakes and breakfast cereals") \
        or sub in ("Sauces", "Spreads", "Salad dressings", "Cooked vegetables (incl. cans)", "Cooked fruit (incl. cans)",
                   "Dough", "Other cereal products", "Pasta", "Muesli mixes and breakfast cereals",
                   "Milk and yoghurt beverages", "Coffee", "Cocoa beverages")
    if "vegan" in name:
        return "plant", composite, False
    pork_hit = has(name, PORK) and "vegetarian" not in name
    if main == "Sausages and cold meats":
        if has(name, ["poultry", "chicken", "turkey"]) and not pork_hit:
            return "poultry", False, False
        if pork_hit:
            return "pork", False, False
        # Beef-only cured meats are named as such; other sausages often contain pork.
        beef_only = has(name, ["beef", "mostbr", "bresaola", "dried meat"]) and "pork" not in name
        return "meat", False, not beef_only
    if main == "Meat and offal":
        if sub == "Pork" or pork_hit:
            return "pork", composite, False
        return ("poultry" if sub == "Poultry" else "meat"), composite, False
    if main == "Fish":
        return ("shellfish" if sub.startswith("Seafood") else "fish"), composite, False
    if main == "Eggs":
        return "egg", False, False
    if main == "Milk and dairy products":
        return "dairy", composite, False
    if main == "Fats and oils" and sub in ("Cream",) and "coconut" not in name:
        return "dairy", False, False
    if sub == "Fats":
        if "lard" in name:
            return "pork", False, False
        if "butter" in name and "cocoa" not in name and "kakao" not in name:
            return "dairy", False, False
        return "plant", False, False
    if sub == "Mayonnaise":
        return "egg", False, False
    # Everything else: keyword rules, most specific animal source first.
    if pork_hit:
        return "pork", composite, False
    if has(name, SHELL):
        return "shellfish", composite, False
    if has(name, FISH):
        return "fish", composite, False
    if has(name, MEAT) and not has(name, ["meat substitute", "minced meat substitute"]):
        poultry = has(name, ["chicken", "turkey", "poultry", "duck", "goose"])
        return ("poultry" if poultry else "meat"), composite, False
    if has(name, DAIRY) and not has(name, ["coconut milk", "almond milk", "oat milk", "soy", "cocoa butter",
                                            "peanut butter", "cream of tartar", "dark chocolate"]):
        return "dairy", composite, False
    if has(name, EGG) and not has(name, ["eggplant", "egg-free", "without egg"]):
        return "egg", composite, False
    return "plant", composite and sub not in PURE_PLANT_SUBS, False


def gluten_of(main, sub, name, group):
    if "gluten-free" in name or "gluten free" in name:
        return 0
    if sub in ("Flour and starch",):
        return 0 if has(name, GLUTEN_FREE_FLOURS) else 1
    if sub == "Pasta":
        return 0 if has(name, ["rice", "corn", "buckwheat", "lentil", "chickpea", "glass noodle"]) else 1
    if has(name, GLUTEN) and not has(name, GLUTEN_FREE_FLOURS + ["oat drink", "eggplant", "almond drink"]):
        if has(name, ["oat", "muesli", "müesli", "porridge"]) and not has(name, ["wheat", "spelt", "rye", "barley", "bread"]):
            return 2
        return 1
    if main in ("Bread, flakes and breakfast cereals",) or sub in ("Dough", "Crispbreads, rusks, crackers and wafers",
                                                                   "Cookies/Biscuits", "Cakes and tarts",
                                                                   "Other sweet pastries"):
        return 1
    if group in ("Prepared dishes", "Sweets & snacks", "Sausages & cold cuts", "Drinks") or sub in ("Sauces", "Spreads", "Salad dressings") \
            or has(name, MAYBE_GLUTEN):
        return 2
    return 0


def quality_of(src, composite, group, name):
    animal = src != "plant"
    if "gelatin" in name:
        return 0.0
    if animal and not composite:
        return 1.0
    if animal:
        return 0.9
    if has(name, ["seitan", "wheat protein", "gluten"]):
        return 0.3
    if has(name, ["soy", "soja", "tofu", "tempeh", "edamame"]):
        return 0.9
    if has(name, ["mycoprotein"]):
        return 0.9
    if has(name, ["pea protein", "plant protein"]):
        return 0.85
    if group == "Beans & lentils":
        return 0.8 if "chickpea" in name else 0.7
    if group == "Nuts & seeds":
        return 0.45 if "peanut" in name else 0.5
    if group == "Grains & bread":
        if "quinoa" in name: return 0.75
        if "buckwheat" in name: return 0.7
        if "rice" in name: return 0.6
        if "oat" in name: return 0.55
        return 0.45
    if group == "Vegetables":
        return 0.85 if "potato" in name and "sweet" not in name else 0.6
    if group == "Plant proteins" and "yeast" in name:
        return 0.8
    if group == "Dairy alternatives":
        return 0.5
    return 0.5 if group == "Fruit" else 0.6


def portion_of(group, sub, name):
    dried = has(name, ["dried", "dry\\b", "uncooked"]) and not has(name, ["dried meat", "dried fruit"])
    if group in ("Meat", "Poultry", "Fish & seafood"):
        return 120, "portion"
    if group == "Sausages & cold cuts":
        return 50, "portion"
    if group == "Eggs":
        if "white" in name: return 35, "1 egg white"
        if "yolk" in name: return 18, "1 yolk"
        return 60, "1 egg"
    if group == "Cheese":
        return 30, "portion"
    if group == "Quark & fresh cheese":
        return 150, "portion"
    if group == "Milk & yoghurt":
        return (180, "1 pot") if "yog" in name else (200, "1 glass")
    if group == "Dairy alternatives":
        return (150, "1 pot") if "yog" in name else (200, "1 glass")
    if group == "Plant proteins":
        if "yeast" in name: return 10, "1 tbsp"
        return (30, "portion, dry") if dried else (100, "portion")
    if group == "Beans & lentils":
        return (60, "portion, dry") if dried else (150, "portion")
    if group == "Nuts & seeds":
        return 30, "handful"
    if group == "Grains & bread":
        if "bread" in name or sub == "Bread and bread products": return 50, "2 slices"
        if sub in ("Crispbreads, rusks, crackers and wafers",): return 20, "portion"
        if sub in ("Flakes, bran and germs", "Muesli mixes and breakfast cereals"): return 50, "portion"
        if "cooked" in name: return 180, "portion"
        return 70, "portion, dry"
    if group == "Vegetables":
        return 150, "portion"
    if group == "Fruit":
        return (30, "portion") if sub == "Dried fruit" else (120, "portion")
    if group == "Prepared dishes":
        if sub == "Sandwiches": return 150, "1 sandwich"
        return 300, "plate"
    if group == "Sweets & snacks":
        return 30, "portion"
    if group == "Fats, sauces & spreads":
        return 15, "1 tbsp"
    if group == "Drinks":
        return 250, "1 glass"
    return 100, "100 g"


def main():
    en_path, de_path = sys.argv[1], sys.argv[2]
    out = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).resolve().parent.parent / "swiss-foods.js"
    en = read_first_sheet(en_path)
    de = read_first_sheet(de_path)
    version = (en[0][0] or "").split("Generic foods")[-1].strip()
    hdr = en[2]
    col = {h: i for i, h in enumerate(hdr) if h and h not in ("Derivation of value", "Source")}
    de_names = {r[0]: r[3] for r in de[3:] if r and r[0]}

    foods = []
    for r in en[3:]:
        if not r or not r[0]:
            continue
        r = r + [None] * (len(hdr) - len(r))
        name = (r[col["Name"]] or "").strip()
        cat = (r[col["Category"]] or "").split(";")[0]
        main_c, _, sub = cat.partition("/")
        kcal = num(r[col["Energy, kilocalories (kcal)"]])
        p = num(r[col["Protein (g)"]])
        if main_c == "Alcoholic beverages" or sub in ("Drinking water", "Salt, spices and flavours",
                                                       "Gelling and binding agents"):
            continue
        if kcal is None or p is None or kcal < 10:
            continue
        f = num(r[col["Fat, total (g)"]]) or 0.0
        c = num(r[col["Carbohydrates, available (g)"]]) or 0.0
        fib = num(r[col["Dietary fibres (g)"]])
        salt = num(r[col["Salt (NaCl) (g)"]])
        low = name.lower()
        group = group_of(main_c, sub, low)
        src, composite, pork_maybe = source_of(main_c, sub, low)
        gl = gluten_of(main_c, sub, low, group)
        q = quality_of(src, composite, group, low)
        sv, sl = portion_of(group, sub, low)
        flags = ("c" if composite else "") + ("k" if pork_maybe else "")
        foods.append([name, group, src, round(kcal), round(p, 1), round(f, 1), round(c, 1),
                      None if fib is None else round(fib, 1), sv, sl, gl, q, "CH",
                      (de_names.get(r[0]) or "").strip(), flags, None if salt is None else round(salt, 2), int(r[0])])

    foods.sort(key=lambda x: x[0].lower())
    header = ("// Generated by tools/build_swiss_data.py from the Swiss Food Composition Database "
              f"{version}, Federal Food Safety and Veterinary Office (FSVO), naehrwertdaten.ch.\n"
              "// Fields: name, group, source, kcal, protein, fat, carbs, fiber, portion g, portion label, gluten,\n"
              "// quality, ref, German name, flags (c = composite dish, k = may contain pork), salt, FSVO id.\n")
    body = "window.SWISS_DB_VERSION = " + json.dumps(version) + ";\nwindow.SWISS_FOODS = [\n" + \
        ",\n".join(json.dumps(x, ensure_ascii=False, separators=(",", ":")) for x in foods) + "\n];\n"
    out.write_text(header + body, encoding="utf-8")
    print(f"{len(foods)} foods -> {out}")


if __name__ == "__main__":
    main()
