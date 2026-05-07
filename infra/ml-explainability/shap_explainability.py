import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
import shap
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, classification_report
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
print(classification_report(y_test, y_pred))

explainer = shap.TreeExplainer(model)
shap_values = explainer.shap_values(X_test)

if isinstance(shap_values, list):
    shap_values_to_use = shap_values[1]
else:
    shap_values_to_use = shap_values

plt.figure(figsize=(10, 8))
shap.summary_plot(shap_values_to_use, X_test, show=False)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/shap_summary_plot.png', dpi=150, bbox_inches='tight')
plt.close()

force_html = shap.force_plot(explainer.expected_value[1] if isinstance(explainer.expected_value, list) else explainer.expected_value,
                              shap_values_to_use[0], X_test.iloc[0], show=False)
shap.save_html(f'{OUTPUT_DIR}/shap_force_plot.html', force_html)

top_idx = np.argmax(model.predict_proba(X_test)[:, 1])
plt.figure(figsize=(10, 8))
shap.waterfall_plot(shap.Explanation(
    values=shap_values_to_use[top_idx],
    base_values=explainer.expected_value[1] if isinstance(explainer.expected_value, list) else explainer.expected_value,
    data=X_test.iloc[top_idx].values,
    feature_names=X_test.columns.tolist()
), show=False)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/shap_waterfall_plot.png', dpi=150, bbox_inches='tight')
plt.close()

mean_abs_shap = np.abs(shap_values_to_use).mean(axis=0)
top_3_features = np.argsort(mean_abs_shap)[::-1][:3]

for feat_idx in top_3_features:
    feat_name = X_test.columns[feat_idx]
    plt.figure(figsize=(10, 8))
    shap.dependence_plot(feat_idx, shap_values_to_use, X_test, show=False)
    plt.tight_layout()
    plt.savefig(f'{OUTPUT_DIR}/shap_dependence_{feat_name}.png', dpi=150, bbox_inches='tight')
    plt.close()

fig, ax = plt.subplots(figsize=(10, 8))
feature_importance = pd.DataFrame({
    'feature': X_test.columns,
    'importance': mean_abs_shap
}).sort_values('importance', ascending=True)

ax.barh(feature_importance['feature'], feature_importance['importance'], color='steelblue')
ax.set_xlabel('Mean |SHAP Value|')
ax.set_title('Global Feature Importance (SHAP)')
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/shap_global_importance.png', dpi=150, bbox_inches='tight')
plt.close()

shap_summary_stats = {
    'feature_importance_ranking': feature_importance.sort_values('importance', ascending=False).to_dict('records'),
    'top_3_features': [X_test.columns[i] for i in top_3_features.tolist()],
    'model_accuracy': float(accuracy),
    'mean_absolute_shap_values': {X_test.columns[i]: float(mean_abs_shap[i]) for i in range(len(mean_abs_shap))}
}

with open(f'{OUTPUT_DIR}/shap_summary_stats.json', 'w') as f:
    json.dump(shap_summary_stats, f, indent=2)

print("SHAP explainability analysis complete.")
print(f"All plots saved to {OUTPUT_DIR}/")
