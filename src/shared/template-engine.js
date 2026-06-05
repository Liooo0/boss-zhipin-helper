// ============================================================
// template-engine.js — 模板变量替换引擎
// 支持 {{variable}} 语法，自动识别可用变量
// ============================================================

// 可用变量列表及其描述
export const AVAILABLE_VARIABLES = {
  positionName: '职位名称',
  companyName: '公司名称',
  jobLocation: '工作地点',
  salary: '薪资范围',
  userName: '用户姓名',
  userSkills: '用户技能',
  userExperience: '用户经验年限',
  expectedSalary: '期望薪资',
  jobDescription: '职位描述摘要',
};

/**
 * 渲染模板，替换所有 {{variable}} 占位符
 * @param {string} template - 模板字符串
 * @param {Object} variables - 变量键值对
 * @param {boolean} keepUnknown - 是否保留未找到的变量占位符
 * @returns {string} 渲染后的文本
 */
export function renderTemplate(template, variables = {}, keepUnknown = false) {
  if (!template) return '';

  return template.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    if (varName in variables && variables[varName] !== undefined && variables[varName] !== '') {
      return variables[varName];
    }
    return keepUnknown ? match : '';
  });
}

/**
 * 提取模板中的所有变量名
 * @param {string} template
 * @returns {string[]}
 */
export function extractVariables(template) {
  if (!template) return [];
  const matches = template.match(/\{\{(\w+)\}\}/g) || [];
  return [...new Set(matches.map(m => m.slice(2, -2)))];
}

/**
 * 验证模板
 * @param {string} template
 * @returns {{ valid: boolean, errors: string[], warnings: string[], variables: string[] }}
 */
export function validateTemplate(template) {
  const result = {
    valid: true,
    errors: [],
    warnings: [],
    variables: [],
  };

  if (!template || !template.trim()) {
    result.valid = false;
    result.errors.push('模板内容不能为空');
    return result;
  }

  // 提取变量
  result.variables = extractVariables(template);

  // 检查是否有无法识别的变量
  for (const varName of result.variables) {
    if (!(varName in AVAILABLE_VARIABLES)) {
      result.warnings.push(`变量 {{${varName}}} 不在预设变量列表中，将由用户自定义`);
    }
  }

  // 检查是否有未闭合的括号
  const openCount = (template.match(/\{\{/g) || []).length;
  const closeCount = (template.match(/\}\}/g) || []).length;
  if (openCount !== closeCount) {
    result.valid = false;
    result.errors.push('模板中的 {{ 和 }} 数量不匹配');
  }

  // 检查模板长度
  if (template.length > 500) {
    result.warnings.push('模板较长（>500字），建议精简以提升回复效率');
  }

  return result;
}

/**
 * 预览模板渲染效果（使用示例值）
 * @param {string} template
 * @returns {string}
 */
export function previewTemplate(template) {
  const sampleValues = {};
  for (const varName of extractVariables(template)) {
    sampleValues[varName] = `[${varName}]`;
  }
  return renderTemplate(template, sampleValues, true);
}

/**
 * 检查模板是否包含特定变量
 * @param {string} template
 * @param {string} varName
 * @returns {boolean}
 */
export function hasVariable(template, varName) {
  const regex = new RegExp(`\\{\\{${varName}\\}\\}`, 'g');
  return regex.test(template);
}
