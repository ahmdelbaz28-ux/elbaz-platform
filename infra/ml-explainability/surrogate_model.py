import numpy as np
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams['font.sans-serif'] = ['Noto Sans SC', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeRegressor, plot_tree
from sklearn.linear_model import LinearRegression
from sklearn.metrics import r2_score, mean_squared_error, mean_absolute_error
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

model_proba = model.predict_proba(X_test)[:, 1]

dt_surrogate = DecisionTreeRegressor(max_depth=4, random_state=42)
dt_surrogate.fit(X_test, model_proba)

fig, ax = plt.subplots(figsize=(20, 12))
plot_tree(dt_surrogate,
          feature_names=X.columns.tolist(),
          filled=True,
          rounded=True,
          fontsize=10,
          ax=ax,
          impurity=False,
          label='root',
          proportion=True)
ax.set_title('Decision Tree Surrogate Model (max_depth=4)', fontsize=16)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/surrogate_decision_tree.png', dpi=150, bbox_inches='tight')
plt.close()

lr_surrogate = LinearRegression()
lr_surrogate.fit(X_test, model_proba)

feature_names = X.columns.tolist()
coefficients = lr_surrogate.coef_

coef_df = pd.DataFrame({
    'feature': feature_names,
    'coefficient': coefficients
}).sort_values('coefficient', ascending=True)

fig, ax = plt.subplots(figsize=(10, 7))
colors = ['#e74c3c' if c < 0 else '#2ecc71' for c in coef_df['coefficient']]
ax.barh(coef_df['feature'], coef_df['coefficient'], color=colors, edgecolor='black', linewidth=0.5)
ax.set_xlabel('Coefficient Value')
ax.set_title('Linear Surrogate Model Coefficients')
ax.axvline(x=0, color='black', linewidth=0.5)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/surrogate_linear_coefficients.png', dpi=150, bbox_inches='tight')
plt.close()

dt_pred = dt_surrogate.predict(X_test)
lr_pred = lr_surrogate.predict(X_test)

metrics = {
    'DecisionTree': {
        'R2': r2_score(model_proba, dt_pred),
        'MSE': mean_squared_error(model_proba, dt_pred),
        'MAE': mean_absolute_error(model_proba, dt_pred),
        'RMSE': np.sqrt(mean_squared_error(model_proba, dt_pred))
    },
    'LinearRegression': {
        'R2': r2_score(model_proba, lr_pred),
        'MSE': mean_squared_error(model_proba, lr_pred),
        'MAE': mean_absolute_error(model_proba, lr_pred),
        'RMSE': np.sqrt(mean_squared_error(model_proba, lr_pred))
    }
}

fig, axes = plt.subplots(1, 3, figsize=(18, 6))

metric_names = ['R2', 'MSE', 'RMSE']
dt_values = [metrics['DecisionTree'][m] for m in metric_names]
lr_values = [metrics['LinearRegression'][m] for m in metric_names]

x = np.arange(len(metric_names))
width = 0.35

bars1 = axes[0].bar(x - width/2, dt_values, width, label='Decision Tree', color='steelblue')
bars2 = axes[0].bar(x + width/2, lr_values, width, label='Linear Regression', color='coral')
axes[0].set_xticks(x)
axes[0].set_xticklabels(metric_names)
axes[0].set_title('Fidelity Metrics Comparison')
axes[0].legend()
for bar in bars1:
    axes[0].text(bar.get_x() + bar.get_width()/2., bar.get_height(),
                f'{bar.get_height():.4f}', ha='center', va='bottom', fontsize=8)
for bar in bars2:
    axes[0].text(bar.get_x() + bar.get_width()/2., bar.get_height(),
                f'{bar.get_height():.4f}', ha='center', va='bottom', fontsize=8)

axes[1].scatter(model_proba, dt_pred, alpha=0.3, s=10, color='steelblue')
min_val = min(model_proba.min(), dt_pred.min())
max_val = max(model_proba.max(), dt_pred.max())
axes[1].plot([min_val, max_val], [min_val, max_val], 'r--', linewidth=2)
axes[1].set_xlabel('Original Model Predictions')
axes[1].set_ylabel('Decision Tree Surrogate Predictions')
axes[1].set_title(f'Decision Tree Fidelity\nR2={metrics["DecisionTree"]["R2"]:.4f}')

axes[2].scatter(model_proba, lr_pred, alpha=0.3, s=10, color='coral')
min_val = min(model_proba.min(), lr_pred.min())
max_val = max(model_proba.max(), lr_pred.max())
axes[2].plot([min_val, max_val], [min_val, max_val], 'r--', linewidth=2)
axes[2].set_xlabel('Original Model Predictions')
axes[2].set_ylabel('Linear Surrogate Predictions')
axes[2].set_title(f'Linear Regression Fidelity\nR2={metrics["LinearRegression"]["R2"]:.4f}')

plt.suptitle('Surrogate Model Fidelity Comparison', fontsize=14, y=1.02)
plt.tight_layout()
plt.savefig(f'{OUTPUT_DIR}/surrogate_fidelity_comparison.png', dpi=150, bbox_inches='tight')
plt.close()

surrogate_report = {
    'decision_tree': {
        'max_depth': 4,
        'fidelity': metrics['DecisionTree'],
        'feature_importances': {feature_names[i]: float(dt_surrogate.feature_importances_[i])
                                for i in range(len(feature_names))}
    },
    'linear_regression': {
        'coefficients': {feature_names[i]: float(coefficients[i]) for i in range(len(feature_names))},
        'intercept': float(lr_surrogate.intercept_),
        'fidelity': metrics['LinearRegression']
    },
    'fidelity_summary': {
        'best_model': 'DecisionTree' if metrics['DecisionTree']['R2'] > metrics['LinearRegression']['R2'] else 'LinearRegression',
        'best_r2': max(metrics['DecisionTree']['R2'], metrics['LinearRegression']['R2'])
    }
}

with open(f'{OUTPUT_DIR}/surrogate_model_results.json', 'w') as f:
    json.dump(surrogate_report, f, indent=2)

print("Surrogate model analysis complete.")
print(f"Decision Tree Fidelity R2: {metrics['DecisionTree']['R2']:.4f}")
print(f"Linear Regression Fidelity R2: {metrics['LinearRegression']['R2']:.4f}")
print(f"All plots saved to {OUTPUT_DIR}/")
