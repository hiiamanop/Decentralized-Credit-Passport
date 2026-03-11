from flask import Flask, request, jsonify
import joblib
import pandas as pd
import numpy as np
import os

app = Flask(__name__)

MODEL_DIR = "models"
CREDIT_MODEL_PATH = os.path.join(MODEL_DIR, "credit_risk_model.pkl")
ENCODERS_PATH = os.path.join(MODEL_DIR, "credit_risk_encoders.pkl")

# Load Models
print("Loading models...")
try:
    credit_model = joblib.load(CREDIT_MODEL_PATH)
    credit_encoders = joblib.load(ENCODERS_PATH)
    print("Models loaded successfully.")
except Exception as e:
    print(f"Error loading models: {e}")
    credit_model = None
    credit_encoders = None

@app.route('/', methods=['GET'])
def health_check():
    return jsonify({"status": "AI Service is running", "models_loaded": credit_model is not None})

@app.route('/predict-score', methods=['POST'])
def predict_score():
    if not credit_model:
        return jsonify({"error": "Model not loaded"}), 500

    data = request.json
    # Expected keys: person_age, person_income, person_home_ownership, person_emp_length, 
    # loan_intent, loan_grade, loan_amnt, loan_int_rate, loan_percent_income, 
    # cb_person_default_on_file, cb_person_cred_hist_length

    try:
        # 1. Prepare Data Frame
        # We need to ensure columns match the training order
        # Training columns: person_age, person_income, person_home_ownership, person_emp_length, 
        # loan_intent, loan_grade, loan_amnt, loan_int_rate, loan_percent_income, 
        # cb_person_default_on_file, cb_person_cred_hist_length
        
        # Ensure columns are in the correct order for the model
        expected_cols = [
            'person_age', 'person_income', 'person_home_ownership', 'person_emp_length',
            'loan_intent', 'loan_grade', 'loan_amnt', 'loan_int_rate',
            'loan_percent_income', 'cb_person_default_on_file', 'cb_person_cred_hist_length'
        ]
        
        # Create DataFrame with ordered columns
        df = pd.DataFrame([input_data])[expected_cols]

        # 2. Encode Categoricals
        cat_cols = ['person_home_ownership', 'loan_intent', 'loan_grade', 'cb_person_default_on_file']
        for col in cat_cols:
            le = credit_encoders[col]
            # Handle unseen labels carefully (fallback to most common or 0)
            try:
                df[col] = le.transform(df[col])
            except ValueError:
                # If label not found (e.g. user sends 'OTHER'), use the first class
                df[col] = le.transform([le.classes_[0]])[0]

        # 3. Predict Probability
        # Class 1 = Default (Bad), Class 0 = Paid (Good)
        prob_default = credit_model.predict_proba(df)[0][1]
        
        # 4. Calculate Credit Score (300 - 850)
        # Higher prob_default -> Lower Score
        # Linear mapping: 0% default -> 850, 100% default -> 300
        score = int(850 - (prob_default * 550))
        
        # Determine Risk Level
        risk_level = "High Risk"
        if score >= 750:
            risk_level = "Low Risk"
        elif score >= 650:
            risk_level = "Medium Risk"

        return jsonify({
            "credit_score": score,
            "risk_level": risk_level,
            "probability_of_default": float(prob_default)
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
