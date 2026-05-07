import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.inspection import PartialDependenceDisplay
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

importances = model.feature_importances_
top_5_features = np.argsort(importances)[::-1][:5]
top_2_features = np.argsort(importances)[::-1][:2]

feature_names = X.columns.tolist()
top_5_names = [feature_names[i] for i in top_5_features]
top_2_names = [feature_names[i] for i in top_2_features]

print("Top 5 features:", top_5_names)
print("Top 2 features for interaction:", top_2_names)

for feat_idx in top_5_features:
    feat_name = feature_names[feat_idx]

    fig, ax = plt.subplots(figsize=(10, 7))
    PartialDependenceDisplay.from_estimator(
        model,
        X_test,
        features=[feat_idx],
        feature_names=feature_names,
        kind='individual',
        ice_lines_kw={'color': 'steelblue', 'alpha': 0.1, 'linewidth': 0.5},
        centered=True,
        ax=ax
    )
    ax.set_title(f'ICE Plot - {feat_name}', fontsize=14)
    plt.tight_layout()
    plt.savefig(f'{OUTPUT_DIR}/pdp_ice_{feat_name}.png', dpi=150, bbox_inches='tight')
    plt.close()
    print(f"Saved ICE plot for {feat_name}")

fig, ax = plt.subplots(figsize=(10, 7))
PartialDependenceDisplay.from_estimator(
    model,
    X_test,
    features=[(top_2_features[0], top_2_features[1])],
    feature_names=feature_names,
    kind='average',
    ax=ax
)
ax.set_title(f'2D Interaction PDP - {top_2_names[0]} vs {top_2_names[1]}', fontsize=14)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/pdp_interaction_2d.png', dpi=150, bbox_inches='tight')
plt.close()
print("Saved 2D interaction PDP plot")

fig, axes = plt.subplots(2, 3, figsize=(18, 12))
axes = axes.flatten()

for i, feat_idx in enumerate(top_5_features):
    feat_name = feature_names[feat_idx]
    PartialDependenceDisplay.from_estimator(
        model,
        X_test,
        features=[feat_idx],
        feature_names=feature_names,
        kind='both',
        ice_lines_kw={'color': 'steelblue', 'alpha': 0.1, 'linewidth': 0.5},
        pd_line_kw={'color': 'red', 'linewidth': 2},
        ax=axes[i]
    )
    axes[i].set_title(f'PDP + ICE - {feat_name}', fontsize=12)

axes[5].set_visible(False)
plt.suptitle('Partial Dependence Plots Grid (Top 5 Features)', fontsize=16, y=1.02)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/pdp_grid.png', dpi=150, bbox_inches='tight')
plt.close()
print("Saved PDP grid plot")

pdp_results = {
    'top_5_features': top_5_names,
    'top_2_features_interaction': top_2_names,
    'feature_importances': {feature_names[i]: float(importances[i]) for i in range(len(importances))},
    'num_features_analyzed': 7
}

with open(f'{OUTPUT_DIR}/pdp_results.json', 'w') as f:
    json.dump(pdp_results, f, indent=2)

print("Partial Dependence analysis complete.")
print(f"All plots saved to {OUTPUT_DIR}/")
