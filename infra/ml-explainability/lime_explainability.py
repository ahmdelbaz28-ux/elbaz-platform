import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import lime
import lime.lime_tabular
import json
import warnings
warnings.filterwarnings('ignore')

OUTPUT_DIR = '/home/z/my-project/infra/ml-explainability'

np.random.seed(42)
n = 1000

enrollment_days_ago = np.random.randint(1, 365, n)
time_spent_hours = np.round(np.random.exponential(10, n), 1)
lessons_completed_pct = np.round(np.clip(np.random.normal(50, 20, n), 0, 100), 1)
avg_quiz_score = np.round(np.clip(np.random.normal(70, 15, n), 0, 100), 1)
login_frequency = np.random.randint(1, 30, n)
course_level_encoded = np.random.randint(0, 4, n)
course_category_encoded = np.random.randint(0, 6, n)

risk_score = (
    0.05 * (enrollment_days_ago / 365) -
    0.15 * (time_spent_hours / 40) +
    0.20 * (1 - lessons_completed_pct / 100) -
    0.30 * (avg_quiz_score / 100) -
    0.10 * (login_frequency / 30) +
    0.05 * course_level_encoded / 3 +
    np.random.normal(0, 0.15, n)
)
y = (risk_score > 0.1).astype(int)

X = pd.DataFrame({
    'enrollment_days_ago': enrollment_days_ago,
    'time_spent_hours': time_spent_hours,
    'lessons_completed_pct': lessons_completed_pct,
    'avg_quiz_score': avg_quiz_score,
    'login_frequency': login_frequency,
    'course_level_encoded': course_level_encoded,
    'course_category_encoded': course_category_encoded
})

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

model = XGBClassifier(
    n_estimators=100,
    max_depth=6,
    learning_rate=0.1,
    random_state=42,
    use_label_encoder=False,
    eval_metric='logloss'
)
model.fit(X_train, y_train)

y_pred = model.predict(X_test)
accuracy = accuracy_score(y_test, y_pred)
print(f"Model Accuracy: {accuracy:.4f}")

lime_explainer = lime.lime_tabular.LimeTabularExplainer(
    X_train.values,
    feature_names=X_train.columns.tolist(),
    class_names=['At Risk', 'Successful'],
    mode='classification',
    random_state=42
)

high_performer_mask = (X_test['avg_quiz_score'] > 90) & (X_test['time_spent_hours'] > 20)
at_risk_mask = (X_test['avg_quiz_score'] < 60) & (X_test['time_spent_hours'] < 5)

if high_performer_mask.any():
    high_idx = X_test[high_performer_mask].index[0]
else:
    high_idx = X_test['avg_quiz_score'].idxmax()

at_risk_indices = X_test[at_risk_mask].index.tolist()
if at_risk_indices:
    at_risk_idx = at_risk_indices[0]
else:
    at_risk_idx = X_test['avg_quiz_score'].idxmin()

avg_idx = X_test.iloc[(X_test['avg_quiz_score'] - X_test['avg_quiz_score'].median()).abs().argsort()[:1]].index[0]

profiles = {
    'high_performer': high_idx,
    'average_student': avg_idx,
    'at_risk_student': at_risk_idx
}

lime_results = {}

for profile_name, idx in profiles.items():
    instance = X_test.loc[idx]
    actual_pred = y_test.loc[idx]
    model_pred = model.predict(instance.values.reshape(1, -1))[0]
    model_proba = model.predict_proba(instance.values.reshape(1, -1))

    explanation = lime_explainer.explain_instance(
        instance.values,
        model.predict_proba,
        num_features=7,
        num_samples=5000
    )

    lime_results[profile_name] = {
        'index': int(idx),
        'actual_label': int(actual_pred),
        'predicted_label': int(model_pred),
        'predicted_proba': model_proba[0].tolist(),
        'local_explanation': explanation.as_list()
    }

    fig = explanation.as_pyplot_figure()
    fig.set_size_inches(10, 6)
    plt.title(f'LIME Explanation - {profile_name.replace("_", " ").title()}\nPredicted: {"Successful" if model_pred == 0 else "At Risk"} (Prob: {model_proba[0][1]:.3f})')
    plt.tight_layout()
    plt.savefig(f'{OUTPUT_DIR}/lime_{profile_name}.png', dpi=150, bbox_inches='tight')
    plt.close()

all_features = X_test.columns.tolist()

fig, axes = plt.subplots(1, 3, figsize=(20, 8))

for i, (profile_name, idx) in enumerate(profiles.items()):
    result = lime_results[profile_name]
    features_contrib = {f: 0.0 for f in all_features}

    for feat_rule, weight in result['local_explanation']:
        for fname in all_features:
            if fname in feat_rule:
                features_contrib[fname] = weight
                break

    feat_names = list(features_contrib.keys())
    feat_weights = list(features_contrib.values())

    colors = ['#e74c3c' if w < 0 else '#2ecc71' for w in feat_weights]
    sorted_indices = np.argsort(feat_weights)
    sorted_names = [feat_names[j] for j in sorted_indices]
    sorted_weights = [feat_weights[j] for j in sorted_indices]
    sorted_colors = [colors[j] for j in sorted_indices]

    axes[i].barh(sorted_names, sorted_weights, color=sorted_colors)
    axes[i].set_title(profile_name.replace('_', ' ').title())
    axes[i].set_xlabel('Feature Weight')
    axes[i].axvline(x=0, color='black', linewidth=0.5)

plt.suptitle('LIME Explanations Comparison Across Student Profiles', fontsize=14, y=1.02)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/lime_comparison.png', dpi=150, bbox_inches='tight')
plt.close()

comparison_data = {
    'model_accuracy': float(accuracy),
    'profiles': lime_results,
    'lime_settings': {
        'num_features': 7,
        'num_samples': 5000
    }
}

with open(f'{OUTPUT_DIR}/lime_results.json', 'w') as f:
    json.dump(comparison_data, f, indent=2, default=str)

print("LIME explainability analysis complete.")
print(f"All plots saved to {OUTPUT_DIR}/")
