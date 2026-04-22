import os
import tempfile
import gradio as gr
from PIL import Image
from ultralytics import YOLO

# Load model once when app starts
MODEL_PATH = "best.pt"
model = YOLO(MODEL_PATH)


def predict_image(image):
    if image is None:
        return None, "Please upload an image."

    # Save uploaded image temporarily
    with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as tmp:
        image.save(tmp.name)
        temp_path = tmp.name

    try:
        # Run prediction
        results = model(temp_path)

        # Get plotted image with boxes
        plotted = results[0].plot()

        # Build a simple text summary
        boxes = results[0].boxes
        count = len(boxes)

        if count == 0:
            summary = "No objects detected."
        else:
            lines = [f"Detected {count} object(s):"]
            for i, box in enumerate(boxes, start=1):
                cls_id = int(box.cls[0].item())
                conf = float(box.conf[0].item())
                class_name = model.names.get(cls_id, str(cls_id))
                lines.append(f"{i}. {class_name} ({conf:.2%})")
            summary = "\n".join(lines)

        return plotted, summary

    except Exception as e:
        return None, f"Error during prediction: {str(e)}"

    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


demo = gr.Interface(
    fn=predict_image,
    inputs=gr.Image(type="pil", label="Upload image"),
    outputs=[
        gr.Image(type="numpy", label="Prediction"),
        gr.Textbox(label="Detection Summary")
    ],
    title="YOLO Model Tester",
    description="Upload an image to test your trained best.pt model."
)

if __name__ == "__main__":
    demo.launch(server_name="0.0.0.0", server_port=7860)