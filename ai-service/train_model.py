import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import classification_report, accuracy_score
import joblib
import os

# Paths to datasets
CREDIT_RISK_PATH = "../dataset/credit_risk_dataset.csv"
CREDIT_CARD_PATH = "../dataset/creditcard.csv"
MODEL_DIR = "models"

os.makedirs(MODEL_DIR, exist_ok=True)

def train_credit_risk_model():
    print("=== Training Credit Risk Model ===")
    
    # 1. Load Data
    if not os.path.exists(CREDIT_RISK_PATH):
        print(f"Error: Dataset not found at {CREDIT_RISK_PATH}")
        return

    df = pd.read_csv(CREDIT_RISK_PATH)
    print(f"Loaded {len(df)} rows.")

    # 2. Preprocessing
    # Handle Missing Values
    # person_emp_length and loan_int_rate usually have nulls
    imputer = SimpleImputer(strategy='median')
    df['person_emp_length'] = imputer.fit_transform(df[['person_emp_length']])
    df['loan_int_rate'] = imputer.fit_transform(df[['loan_int_rate']])

    # Encode Categorical Variables
    # Columns: person_home_ownership, loan_intent, loan_grade, cb_person_default_on_file
    cat_cols = ['person_home_ownership', 'loan_intent', 'loan_grade', 'cb_person_default_on_file']
    label_encoders = {}
    
    for col in cat_cols:
        le = LabelEncoder()
        df[col] = le.fit_transform(df[col])
        label_encoders[col] = le
    
    # Save Encoders for Inference
    joblib.dump(label_encoders, os.path.join(MODEL_DIR, "credit_risk_encoders.pkl"))

    # Features & Target
    X = df.drop('loan_status', axis=1)
    y = df['loan_status']

    # Split Data
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

    # 3. Train Model
    # Using Random Forest as it handles non-linear relationships well
    clf = RandomForestClassifier(n_estimators=100, random_state=42)
    clf.fit(X_train, y_train)

    # 4. Evaluate
    y_pred = clf.predict(X_test)
    print("Accuracy:", accuracy_score(y_test, y_pred))
    print(classification_report(y_test, y_pred))

    # 5. Save Model
    joblib.dump(clf, os.path.join(MODEL_DIR, "credit_risk_model.pkl"))
    print("Credit Risk Model Saved!")

def train_fraud_model():
    print("\n=== Training Fraud Detection Model ===")
    
    # 1. Load Data
    if not os.path.exists(CREDIT_CARD_PATH):
        print(f"Error: Dataset not found at {CREDIT_CARD_PATH}")
        return

    # Read only a sample if file is too large (creditcard.csv is ~150MB, usually okay, but let's be safe)
    df = pd.read_csv(CREDIT_CARD_PATH)
    print(f"Loaded {len(df)} rows.")

    # 2. Preprocessing
    # The dataset is highly unbalanced (Class 0 >>> Class 1)
    # For this demo, we'll use a simple undersampling or just weighted training
    # We'll stick to weighted training for simplicity
    
    X = df.drop('Class', axis=1)
    y = df['Class']

    # Scale 'Amount' and 'Time' as V1-V28 are already scaled (PCA)
    scaler = StandardScaler()
    X['Amount'] = scaler.fit_transform(X[['Amount']])
    X['Time'] = scaler.fit_transform(X[['Time']])

    # Save Scaler
    joblib.dump(scaler, os.path.join(MODEL_DIR, "fraud_scaler.pkl"))

    # Split
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    # 3. Train Model
    # Class_weight='balanced' helps with the imbalance
    clf = RandomForestClassifier(n_estimators=50, random_state=42, class_weight='balanced', n_jobs=-1)
    clf.fit(X_train, y_train)

    # 4. Evaluate
    y_pred = clf.predict(X_test)
    print("Accuracy:", accuracy_score(y_test, y_pred))
    print(classification_report(y_test, y_pred))

    # 5. Save Model
    joblib.dump(clf, os.path.join(MODEL_DIR, "fraud_model.pkl"))
    print("Fraud Model Saved!")

if __name__ == "__main__":
    train_credit_risk_model()
    train_fraud_model()
