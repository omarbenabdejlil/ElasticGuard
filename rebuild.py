# save as rebuild.py
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet

with open("output.txt") as f:
    content = f.read()

doc = SimpleDocTemplate("final.pdf", pagesize=A4)
styles = getSampleStyleSheet()
story = [Paragraph(line or " ", styles["Normal"]) for line in content.split("\n")]
doc.build(story)
