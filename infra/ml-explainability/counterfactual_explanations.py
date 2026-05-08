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
from scipy.optimize import minimize
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

feature_names = X.columns.tolist()
feature_ranges = {
    'enrollment_days_ago': (1, 365),
    'time_spent_hours': (0.1, 80.0),
    'lessons_completed_pct': (0, 100),
    'avg_quiz_score': (0, 100),
    'login_frequency': (1, 30),
    'course_level_encoded': (0, 3),
    'course_category_encoded': (0, 5)
}

def find_counterfactual(original, target_class, max_changes=3, weight_penalty=10.0):
    original_np = original.values.flatten()
    immutable_features = ['course_level_encoded', 'course_category_encoded']
    mutable_mask = np.array([1.0 if fname not in immutable_features else 0.0 for fname in feature_names])

    def objective(x):
        original_scaled = (x - original_np) * mutable_mask
        l1_change = np.sum(np.abs(original_scaled))
        l2_change = np.sum((original_scaled) ** 2)
        prob = model.predict_proba(x.reshape(1, -1))[0]
        if target_class == 1:
            prob_diff = max(0, 0.5 - prob[1])
        else:
            prob_diff = max(0, prob[1] - 0.5)
        return weight_penalty * l1_change + l2_change + 100 * prob_diff

    bounds = [feature_ranges[fname] for fname in feature_names]
    result = minimize(objective, original_np, method='L-BFGS-B', bounds=bounds,
                      options={'maxiter': 1000})

    cf_values = result.x
    changed_features = []
    for i, fname in enumerate(feature_names):
        if abs(cf_values[i] - original_np[i]) > 0.01 and mutable_mask[i] > 0:
            changed_features.append({
                'feature': fname,
                'original': round(float(original_np[i]), 2),
                'counterfactual': round(float(cf_values[i]), 2),
                'change': round(float(cf_values[i] - original_np[i]), 2)
            })

    changed_features.sort(key=lambda x: abs(x['change']), reverse=True)
    return cf_values, changed_features[:max_changes], result.fun

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

counterfactual_results = {}

for profile_name, idx in profiles.items():
    instance = X_test.loc[idx]
    original_pred = model.predict(instance.values.reshape(1, -1))[0]
    original_proba = model.predict_proba(instance.values.reshape(1, -1))[0]
    target_class = 1 - original_pred

    cf_values, changed_features, obj_val = find_counterfactual(instance, target_class)
    cf_proba = model.predict_proba(cf_values.reshape(1, -1))[0]

    counterfactual_results[profile_name] = {
        'original_prediction': int(original_pred),
        'original_probability': {
            'at_risk': float(original_proba[1]),
            'successful': float(original_proba[0])
        },
        'counterfactual_prediction': int(target_class),
        'counterfactual_probability': {
            'at_risk': float(cf_proba[1]),
            'successful': float(cf_proba[0])
        },
        'changed_features': changed_features,
        'num_changes': len(changed_features),
        'objective_value': float(obj_val)
    }

fig, axes = plt.subplots(1, 3, figsize=(20, 8))

for i, (profile_name, idx) in enumerate(profiles.items()):
    result = counterfactual_results[profile_name]
    instance = X_test.loc[idx]
    changed = result['changed_features']

    if changed:
        feat_names = [c['feature'].replace('_', '\n') for c in changed]
        original_vals = [c['original'] for c in changed]
        cf_vals = [c['counterfactual'] for c in changed]

        x = np.arange(len(feat_names))
        width = 0.35
        axes[i].bar(x - width/2, original_vals, width, label='Original', color='#e74c3c', alpha=0.8)
        axes[i].bar(x + width/2, cf_vals, width, label='Counterfactual', color='#2ecc71', alpha=0.8)
        axes[i].set_xticks(x)
        axes[i].set_xticklabels(feat_names, fontsize=8)
        axes[i].set_ylabel('Feature Value')
        axes[i].legend()
        axes[i].set_title(f"{profile_name.replace('_', ' ').title()}\n"
                         f"Pred: {'At Risk' if result['original_prediction'] == 1 else 'Successful'} → "
                         f"{'At Risk' if result['counterfactual_prediction'] == 1 else 'Successful'}\n"
                         f"Prob: {result['original_probability']['at_risk']:.3f} → "
                         f"{result['counterfactual_probability']['at_risk']:.3f}")
    else:
        axes[i].text(0.5, 0.5, 'No minimal changes found\n(prediction already optimal)',
                    ha='center', va='center', transform=axes[i].transAxes)
        axes[i].set_title(profile_name.replace('_', ' ').title())

plt.suptitle('Counterfactual Explanations: Minimal Changes to Flip Predictions', fontsize=14, y=1.02)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/counterfactual_analysis.png', dpi=150, bbox_inches='tight')
plt.close()

fig, axes = plt.subplots(2, 2, figsize=(14, 10))

num_changes = [counterfactual_results[p]['num_changes'] for p in profiles.keys()]
profile_labels = [p.replace('_', '\n').title() for p in profiles.keys()]

axes[0, 0].bar(profile_labels, num_changes, color=['#2ecc71', '#f39c12', '#e74c3c'])
axes[0, 0].set_ylabel('Number of Features Changed')
axes[0, 0].set_title('Sparsity: Number of Changes Needed')

original_risk_probs = [counterfactual_results[p]['original_probability']['at_risk'] for p in profiles.keys()]
cf_risk_probs = [counterfactual_results[p]['counterfactual_probability']['at_risk'] for p in profiles.keys()]

x = np.arange(len(profile_labels))
width = 0.35
axes[0, 1].bar(x - width/2, original_risk_probs, width, label='Original', color='coral')
axes[0, 1].bar(x + width/2, cf_risk_probs, width, label='Counterfactual', color='lightgreen')
axes[0, 1].set_xticks(x)
axes[0, 1].set_xticklabels(profile_labels, fontsize=9)
axes[0, 1].set_ylabel('At-Risk Probability')
axes[0, 1].set_title('Probability Shift')
axes[0, 1].legend()

obj_values = [counterfactual_results[p]['objective_value'] for p in profiles.keys()]
axes[1, 0].bar(profile_labels, obj_values, color=['#2ecc71', '#f39c12', '#e74c3c'])
axes[1, 0].set_ylabel('Objective Value (Lower = Better)')
axes[1, 0].set_title('Counterfactual Quality (Optimization Objective)')

feature_change_counts = {}
for profile_name, result in counterfactual_results.items():
    for change in result['changed_features']:
        fname = change['feature']
        if fname not in feature_change_counts:
            feature_change_counts[fname] = 0
        feature_change_counts[fname] += 1

if feature_change_counts:
    fc_df = pd.DataFrame({
        'feature': list(feature_change_counts.keys()),
        'count': list(feature_change_counts.values())
    }).sort_values('count', ascending=True)
    axes[1, 1].barh(fc_df['feature'].str.replace('_', '\n'), fc_df['count'], color='steelblue')
    axes[1, 1].set_xlabel('Times Changed Across Profiles')
    axes[1, 1].set_title('Most Commonly Changed Features')
else:
    axes[1, 1].text(0.5, 0.5, 'No changes needed', ha='center', va='center')

plt.suptitle('Counterfactual Quality Analysis', fontsize=14, y=1.02)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/counterfactual_quality.png', dpi=150, bbox_inches='tight')
plt.close()

with open(f'{OUTPUT_DIR}/counterfactual_results.json', 'w') as f:
    json.dump(counterfactual_results, f, indent=2)

print("Counterfactual explanation analysis complete.")
print(f"All plots saved to {OUTPUT_DIR}/")
