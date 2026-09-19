"""Regenerate the small Phase 0 reading sample; not an application dependency."""

from pathlib import Path
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

destination = Path(__file__).resolve().parents[1] / "output/pdf/plate-tectonics-spike.pdf"
destination.parent.mkdir(parents=True, exist_ok=True)
pdf = canvas.Canvas(str(destination), pagesize=letter)
pdf.setTitle("Plate tectonics - Phase 0 reading sample")
pdf.setFont("Helvetica-Bold", 19)
pdf.drawString(54, 738, "Plate tectonics: a short reading sample")
pdf.setFont("Helvetica", 11)
lines = [
    "Earth's outer shell is divided into moving plates. At divergent boundaries,",
    "plates move apart; at convergent boundaries, plates meet. Transform boundaries",
    "allow plates to slide past each other. These motions help explain the patterns",
    "of earthquakes, volcanoes, and mountain building.",
    "",
    "Evidence to investigate",
    "Matching fossils and rock layers across oceans suggest past continental movement.",
    "Modern satellite positioning can measure present-day plate movement.",
    "",
    "Study question: How would you distinguish motion from a competing explanation?",
]
y = 694
for line in lines:
    if line == "Evidence to investigate":
        pdf.setFont("Helvetica-Bold", 12)
    else:
        pdf.setFont("Helvetica", 11)
    pdf.drawString(54, y, line)
    y -= 22
pdf.setFont("Helvetica-Oblique", 9)
pdf.drawString(54, 44, "Self-authored Phase 0 fixture - not an imported workspace source")
pdf.save()
