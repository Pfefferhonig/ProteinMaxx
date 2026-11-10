# ProteinMaxx

Find the foods that give you the most protein for the calories, then build meals that hit your protein target.

**Live site:** https://pfefferhonig.github.io/ProteinMaxx/proteinmaxx.html

## Features

- **Browse foods**: about 1,170 foods from the Swiss Food Composition Database, plus a USDA list. Foods are ranked by protein per 100 kcal, % of calories from protein, quality-adjusted protein, protein density or protein per serving.
- **Filters**: diet (pescatarian, vegetarian, vegan), gluten-free, dairy-free, no pork, low-carb, lean, whole foods only, food type and minimum protein density. Search works with English or German names.
- **Efficiency vs. density chart**: shows which foods are both lean and compact enough to eat in practice.
- **Meal builder**: add ingredients with gram amounts and see protein, calories, macros and salt, in total or per serving.
  - Each meal has its own protein target and an optional calorie target. Starting targets depend on the meal type: breakfast 30 g, lunch 40 g, dinner 40 g, snack 20 g.
  - A diet check shows whether the meal is vegan, vegetarian, pescatarian or gluten-free.
  - Protein top-ups suggest the foods that reach your target with the fewest extra calories.
  - Meals can be copied as plain text.
- **My foods**: add your own products by typing in the label values, or look them up by barcode on Open Food Facts.

Meals and your own foods are saved in your browser's local storage. They aren't uploaded anywhere and don't sync between devices.

## Files

| File | What it is |
|---|---|
| `proteinmaxx.html` | The page: Browse foods tab, styles, USDA list |
| `meal-builder.js` | Meal builder, protein top-ups, My foods and the Open Food Facts lookup |
| `swiss-foods.js` | Generated Swiss food data (do not edit by hand) |
| `tools/build_swiss_data.py` | Rebuilds `swiss-foods.js` from the FSVO Excel files |

## Running it locally

Open `proteinmaxx.html` through a local web server so the data files load:

```bash
python -m http.server 8000
```

Then go to http://localhost:8000/proteinmaxx.html. Barcode lookups need an internet connection.

## Updating the Swiss data

1. Download the English and German Excel files from https://naehrwertdaten.ch/en/downloads/.
2. Run:

```bash
python tools/build_swiss_data.py Swiss_food_composition_database.xlsx Schweizer_Nahrwertdatenbank.xlsx
```

The script only uses the Python standard library.

## Data sources and credits

- **Swiss Food Composition Database**, Federal Food Safety and Veterinary Office (FSVO), https://naehrwertdaten.ch. Free to use, including commercially, with acknowledgment of the source.
- **USDA FoodData Central**, https://fdc.nal.usda.gov. Public domain.
- **Open Food Facts**, https://world.openfoodfacts.org. Product data is available under the [Open Database License (ODbL)](https://opendatacommons.org/licenses/odbl/1-0/). ProteinMaxx looks up one product at a time and keeps the result only in your browser. If you publish a collection of Open Food Facts products, that collection must also be under the ODbL.

Diet, gluten, pork, protein-quality and portion tags are ProteinMaxx's own estimates, made by rules from each food's category and name. They are not part of these databases. Protein-quality scores are approximations based on published DIAAS and PDCAAS values.

Nutrition values are for information only and are not medical advice.
