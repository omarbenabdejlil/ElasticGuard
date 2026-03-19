import fitz
from fitz import Point

doc = fitz.open("input.pdf")

replacements = [
    (" : France", " : Tunisie"),
    # add more pairs as needed
]

for page in doc:
    for old_text, new_text in replacements:
        areas = page.search_for(old_text)
        for rect in areas:
            # Cover old text with white box
            page.draw_rect(rect, color=(1,1,1), fill=(1,1,1))
            # Insert new text at baseline position
            page.insert_text(
                Point(rect.x0, rect.y1 - 2),
                new_text,
                fontsize=11,
                color=(0, 0, 0)
            )

doc.save("output.pdf")
print("Done — saved as output.pdf")
