import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score
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
y_proba = model.predict_proba(X_test)[:, 1]

overall_accuracy = accuracy_score(y_test, y_pred)
overall_auc = roc_auc_score(y_test, y_proba)

analysis_df = X_test.copy()
analysis_df['y_true'] = y_test
analysis_df['y_pred'] = y_pred
analysis_df['y_proba'] = y_proba

level_map = {0: 'Beginner', 1: 'Elementary', 2: 'Intermediate', 3: 'Advanced'}
analysis_df['course_level'] = analysis_df['course_level_encoded'].map(level_map)

median_enrollment = analysis_df['enrollment_days_ago'].median()
analysis_df['enrollment_period'] = np.where(
    analysis_df['enrollment_days_ago'] <= median_enrollment, 'Recent', 'Old'
)

analysis_df['login_frequency_group'] = pd.cut(
    analysis_df['login_frequency'],
    bins=[0, 7, 14, 30],
    labels=['Low (1-7)', 'Medium (8-14)', 'High (15-30)']
)

def compute_group_metrics(df, group_col, group_label):
    metrics = {}
    overall_selection_rate = df['y_pred'].mean()
    overall_mean_pred = df['y_proba'].mean()

    for group_val in df[group_col].unique():
        group_data = df[df[group_col] == group_val]
        if len(group_data) < 5:
            continue

        selection_rate = group_data['y_pred'].mean()
        mean_prediction = group_data['y_proba'].mean()
        accuracy = accuracy_score(group_data['y_true'], group_data['y_pred'])

        if overall_selection_rate > 0:
            disparate_impact = selection_rate / overall_selection_rate
        else:
            disparate_impact = 1.0

        metrics[str(group_val)] = {
            'count': int(len(group_data)),
            'selection_rate': round(float(selection_rate), 4),
            'mean_prediction': round(float(mean_prediction), 4),
            'accuracy': round(float(accuracy), 4),
            'disparate_impact_ratio': round(float(disparate_impact), 4),
            'prediction_difference': round(float(mean_prediction - overall_mean_pred), 4)
        }

    return metrics

bias_report = {
    'overall_metrics': {
        'accuracy': round(float(overall_accuracy), 4),
        'auc': round(float(overall_auc), 4),
        'selection_rate': round(float(y_pred.mean()), 4),
        'mean_prediction': round(float(y_proba.mean()), 4),
        'total_samples': len(y_test)
    }
}

course_level_metrics = compute_group_metrics(analysis_df, 'course_level', 'Course Level')
bias_report['course_level'] = course_level_metrics

enrollment_metrics = compute_group_metrics(analysis_df, 'enrollment_period', 'Enrollment Period')
bias_report['enrollment_period'] = enrollment_metrics

login_metrics = compute_group_metrics(analysis_df, 'login_frequency_group', 'Login Frequency Group')
bias_report['login_frequency_group'] = login_metrics

all_disparate_impacts = []
for group_type in ['course_level', 'enrollment_period', 'login_frequency_group']:
    for group_val, metrics in bias_report[group_type].items():
        all_disparate_impacts.append(metrics['disparate_impact_ratio'])

bias_report['summary'] = {
    'max_disparate_impact': round(float(max(all_disparate_impacts)), 4),
    'min_disparate_impact': round(float(min(all_disparate_impacts)), 4),
    'mean_disparate_impact': round(float(np.mean(all_disparate_impacts)), 4),
    'potential_bias_flags': []
}

for group_type in ['course_level', 'enrollment_period', 'login_frequency_group']:
    for group_val, metrics in bias_report[group_type].items():
        di = metrics['disparate_impact_ratio']
        if di < 0.8 or di > 1.25:
            bias_report['summary']['potential_bias_flags'].append({
                'group_type': group_type,
                'group_value': group_val,
                'disparate_impact': di,
                'flag': 'Below 80% threshold' if di < 0.8 else 'Above 125% threshold'
            })

fig, axes = plt.subplots(2, 2, figsize=(16, 12))

groups_data = [
    ('course_level', 'Course Level', course_level_metrics, axes[0, 0]),
    ('enrollment_period', 'Enrollment Period', enrollment_metrics, axes[0, 1]),
    ('login_frequency_group', 'Login Frequency', login_metrics, axes[1, 0])
]

for group_col, title, metrics, ax in groups_data:
    group_labels = list(metrics.keys())
    selection_rates = [metrics[g]['selection_rate'] for g in group_labels]
    mean_preds = [metrics[g]['mean_prediction'] for g in group_labels]

    x = np.arange(len(group_labels))
    width = 0.35
    bars1 = ax.bar(x - width/2, selection_rates, width, label='Selection Rate', color='steelblue')
    bars2 = ax.bar(x + width/2, mean_preds, width, label='Mean Prediction', color='coral')
    ax.set_xticks(x)
    ax.set_xticklabels(group_labels, rotation=45, ha='right', fontsize=9)
    ax.set_ylabel('Rate / Probability')
    ax.set_title(f'{title} - Group Metrics')
    ax.legend(fontsize=8)
    ax.axhline(y=overall_accuracy, color='green', linestyle='--', alpha=0.5, label='Overall')

di_data = []
di_labels = []
di_colors = []
for group_type in ['course_level', 'enrollment_period', 'login_frequency_group']:
    for group_val, metrics in bias_report[group_type].items():
        label = f"{group_type[:3].upper()}:{group_val}"
        di_data.append(metrics['disparate_impact_ratio'])
        di_labels.append(label)
        di = metrics['disparate_impact_ratio']
        if di < 0.8:
            di_colors.append('#e74c3c')
        elif di > 1.25:
            di_colors.append('#f39c12')
        else:
            di_colors.append('#2ecc71')

axes[1, 1].barh(di_labels, di_data, color=di_colors, edgecolor='black', linewidth=0.5)
axes[1, 1].axvline(x=1.0, color='black', linewidth=2, linestyle='-')
axes[1, 1].axvline(x=0.8, color='red', linewidth=1, linestyle='--', alpha=0.7)
axes[1, 1].axvline(x=1.25, color='orange', linewidth=1, linestyle='--', alpha=0.7)
axes[1, 1].set_xlabel('Disparate Impact Ratio')
axes[1, 1].set_title('Disparate Impact Ratio by Group')
axes[1, 1].fill_betweenx([0, len(di_labels)], 0.8, 1.25, alpha=0.1, color='green')

plt.suptitle('Fairness & Bias Detection Report\nAhmed El-Baz LMS Platform - Student Performance Prediction',
             fontsize=14, y=1.02)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/bias_detection_report.png', dpi=150, bbox_inches='tight')
plt.close()

with open(f'{OUTPUT_DIR}/bias_detection_results.json', 'w') as f:
    json.dump(bias_report, f, indent=2)

print("Bias detection analysis complete.")
print(f"Overall Accuracy: {overall_accuracy:.4f}")
print(f"Overall AUC: {overall_auc:.4f}")
print(f"Potential Bias Flags: {len(bias_report['summary']['potential_bias_flags'])}")
print(f"All outputs saved to {OUTPUT_DIR}/")
