import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.inspection import permutation_importance
from sklearn.metrics import accuracy_score
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

perm_result = permutation_importance(
    model, X_test, y_test,
    n_repeats=30,
    random_state=42,
    scoring='accuracy',
    n_jobs=-1
)

feature_names = X.columns.tolist()
sorted_idx = perm_result.importances_mean.argsort()

fig, ax = plt.subplots(figsize=(10, 7))
ax.barh(
    [feature_names[i] for i in sorted_idx],
    perm_result.importances_mean[sorted_idx],
    xerr=perm_result.importances_std[sorted_idx],
    color='steelblue',
    capsize=3
)
ax.set_xlabel('Mean Accuracy Decrease')
ax.set_title('Permutation Feature Importance (n_repeats=30)')
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/permutation_importance_bar.png', dpi=150, bbox_inches='tight')
plt.close()

fig, ax = plt.subplots(figsize=(10, 7))
ax.boxplot(
    perm_result.importances[sorted_idx].T,
    labels=[feature_names[i] for i in sorted_idx],
    vert=False,
    patch_artist=True,
    boxprops=dict(facecolor='lightblue', color='steelblue'),
    medianprops=dict(color='red')
)
ax.set_xlabel('Accuracy Decrease')
ax.set_title('Permutation Importance Distribution (Boxplot)')
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/permutation_importance_boxplot.png', dpi=150, bbox_inches='tight')
plt.close()

feature_categories = {
    'Engagement': ['time_spent_hours', 'login_frequency'],
    'Performance': ['avg_quiz_score', 'lessons_completed_pct'],
    'Context': ['enrollment_days_ago', 'course_level_encoded', 'course_category_encoded']
}

category_importance = {}
for cat, feats in feature_categories.items():
    cat_indices = [feature_names.index(f) for f in feats if f in feature_names]
    cat_mean = np.mean([perm_result.importances_mean[i] for i in cat_indices])
    cat_std = np.std([perm_result.importances_mean[i] for i in cat_indices])
    category_importance[cat] = {'mean': cat_mean, 'std': cat_std, 'features': feats}

categories = list(category_importance.keys())
means = [category_importance[c]['mean'] for c in categories]
stds = [category_importance[c]['std'] for c in categories]

fig, ax = plt.subplots(figsize=(10, 6))
bars = ax.bar(categories, means, yerr=stds, capsize=5,
              color=['#2ecc71', '#e74c3c', '#3498db'],
              edgecolor='black', linewidth=0.5)
ax.set_ylabel('Mean Accuracy Decrease')
ax.set_title('Permutation Importance by Feature Category')
for bar, mean_val in zip(bars, means):
    ax.text(bar.get_x() + bar.get_width()/2., bar.get_height() + 0.001,
            f'{mean_val:.4f}', ha='center', va='bottom', fontsize=10)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/permutation_importance_grouped.png', dpi=150, bbox_inches='tight')
plt.close()

xgb_importance = model.feature_importances_
xgb_importance_norm = xgb_importance / xgb_importance.sum()
perm_importance_norm = perm_result.importances_mean / perm_result.importances_mean.sum()

comparison_df = pd.DataFrame({
    'Feature': feature_names,
    'XGBoost_Importance': xgb_importance_norm,
    'Permutation_Importance': perm_importance_norm
})
comparison_df = comparison_df.sort_values('Permutation_Importance', ascending=True)

fig, ax = plt.subplots(figsize=(12, 7))
y_pos = np.arange(len(comparison_df))
bar_height = 0.35

ax.barh(y_pos - bar_height/2, comparison_df['XGBoost_Importance'], bar_height,
        label='XGBoost Native', color='steelblue')
ax.barh(y_pos + bar_height/2, comparison_df['Permutation_Importance'], bar_height,
        label='Permutation', color='coral')
ax.set_yticks(y_pos)
ax.set_yticklabels(comparison_df['Feature'])
ax.set_xlabel('Normalized Importance')
ax.set_title('XGBoost Native vs Permutation Feature Importance')
ax.legend(loc='lower right')
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/permutation_vs_xgboost_importance.png', dpi=150, bbox_inches='tight')
plt.close()

perm_results = {
    'model_accuracy': float(accuracy),
    'permutation_importance': {
        feature_names[i]: {
            'mean': float(perm_result.importances_mean[i]),
            'std': float(perm_result.importances_std[i])
        } for i in range(len(feature_names))
    },
    'xgboost_native_importance': {
        feature_names[i]: float(xgb_importance[i]) for i in range(len(feature_names))
    },
    'category_importance': {k: {'mean': float(v['mean']), 'std': float(v['std']), 'features': v['features']}
                           for k, v in category_importance.items()},
    'top_features': {
        'permutation': [feature_names[i] for i in sorted_idx[::-1][:5]],
        'xgboost': [feature_names[i] for i in np.argsort(xgb_importance)[::-1][:5]]
    }
}

with open(f'{OUTPUT_DIR}/permutation_importance_results.json', 'w') as f:
    json.dump(perm_results, f, indent=2)

print("Permutation importance analysis complete.")
print(f"All plots saved to {OUTPUT_DIR}/")
