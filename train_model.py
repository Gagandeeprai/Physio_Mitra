import pandas as pd
from xgboost import XGBClassifier
import pickle

print("Loading dataset...")
df = pd.read_csv('squat_features_augmented.csv')

features = [
    'left_knee_angle', 'right_knee_angle', 'left_hip_angle', 'right_hip_angle',
    'left_ankle_angle', 'right_ankle_angle', 'spine_angle', 'torso_lean',
    'left_knee_lateral', 'right_knee_lateral', 'symmetry_score', 'hip_depth'
]

X = df[features]
y = df['label']

# Remove 'Heels Off Ground' (class 4) and 'Asymmetric Squat' (class 5)
df_filtered = df[~df['label'].isin([4, 5])].copy()

X = df_filtered[features]
y = df_filtered['label']

print("Training XGBoost model...")
model = XGBClassifier(eval_metric='mlogloss')
model.fit(X, y)

print("Saving model to squat_xgb_model.pkl...")
with open('squat_xgb_model.pkl', 'wb') as f:
    pickle.dump(model, f)

print("Training complete! Model saved successfully.")
