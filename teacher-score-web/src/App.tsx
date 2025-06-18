import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";

// ----- 常量与工具 -----
const ROLE_INFO = {
  "班主任": { code: "CLASS", caps: 15, baselines: [1, 1.5], color: "bg-blue-500", lightColor: "bg-blue-100" },
  "副班主任": { code: "VICE", caps: 15, baselines: [0.5, 0.75], color: "bg-indigo-500", lightColor: "bg-indigo-100" },
  "年级组长": { code: "GRADE", caps: 15, baselines: [1, 1.5], color: "bg-purple-500", lightColor: "bg-purple-100" },
  "科组长": { code: "SUBJECT", caps: 15, baselines: [1, 1.5], color: "bg-pink-500", lightColor: "bg-pink-100" },
  "备课组长": { code: "PREP", caps: 8, baselines: [0.5], color: "bg-green-500", lightColor: "bg-green-100" },
  "中层干部": { code: "MID", caps: 20, baselines: [1.2, 1.5], color: "bg-orange-500", lightColor: "bg-orange-100" },
  "学科主任": { code: "DEPT", caps: 15, baselines: [1, 1.5], color: "bg-teal-500", lightColor: "bg-teal-100" },
};

const WEIGHTS = [1, 0.5, 0.25, 0.125, 0.0625];
const CLASS_VICE_COMBO_CAP = 15;

type RoleKey = keyof typeof ROLE_INFO;

function ymToIndex(dateStr: string): number {
  const [y, m] = dateStr.split("-").map(Number);
  return y * 12 + (m - 1);
}

function indexToYM(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

interface RoleEntry { role: RoleKey; start: string; end: string; }
interface RoleState { score: number; monthsServed: number; capped: boolean; }
interface MonthAllocation { role: RoleKey; weight: number; gain: number; }
interface MonthDetail { ym: string; allocations: MonthAllocation[]; }
interface RoleSummary { role: RoleKey; score: number; cap: number; capped: boolean; }
interface CalculationResult { roleSummary: RoleSummary[]; totalScore: number; monthDetails: MonthDetail[]; }

function calculate(csvText: string): CalculationResult {
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const entries: RoleEntry[] = lines.map((line, idx) => {
    const match = line.match(/\"?(.*?)\"?,\s*\"?(\d{4}-\d{2}-\d{2})\"?,\s*\"?(\d{4}-\d{2}-\d{2})\"?/);
    if (!match) throw new Error(`第 ${idx + 1} 行 CSV 格式有误：${line}`);
    const [, role, start, end] = match;
    if (!ROLE_INFO[role as RoleKey]) throw new Error(`未知岗位名称：${role}`);
    if (end < start) throw new Error(`日期顺序错误：${role}`);
    return { role: role as RoleKey, start, end };
  });

  const minYM = Math.min(...entries.map(e => ymToIndex(e.start)));
  const maxYM = Math.max(...entries.map(e => ymToIndex(e.end)));
  const monthsTotal = maxYM - minYM + 1;

  const roleState = Object.fromEntries(Object.keys(ROLE_INFO).map(r => [r, { score: 0, monthsServed: 0, capped: false }])) as Record<RoleKey, RoleState>;
  const monthDetails: MonthDetail[] = [];

  for (let i = 0; i < monthsTotal; i++) {
    const ymIdx = minYM + i;
    const ymStr = indexToYM(ymIdx);
    const activeRoles = entries.filter(e => ymIdx >= ymToIndex(e.start) && ymIdx <= ymToIndex(e.end)).map(e => e.role).filter(r => !roleState[r].capped);
    if (!activeRoles.length) continue;

    activeRoles.forEach(r => { roleState[r].monthsServed += 1; });

    const candidates = activeRoles.map(role => {
      const info = ROLE_INFO[role];
      const monthsSrv = roleState[role].monthsServed - 1;
      const baseline = info.baselines[monthsSrv >= 72 && info.baselines.length > 1 ? 1 : 0];
      return { role, baselinePerMonth: baseline / 12, remainingCap: info.caps - roleState[role].score + 1e-9 };
    });

    candidates.sort((a,b)=> b.baselinePerMonth - a.baselinePerMonth || b.remainingCap - a.remainingCap);

    const monthLog: MonthDetail = { ym: ymStr, allocations: [] };
    for (let w = 0; w < WEIGHTS.length && w < candidates.length; w++) {
      const { role, baselinePerMonth } = candidates[w];
      const weight = WEIGHTS[w];
      let gain = baselinePerMonth * weight;

      if (role === "班主任" || role === "副班主任") {
        const comboUsed = roleState["班主任"].score + roleState["副班主任"].score;
        const remainingCombo = CLASS_VICE_COMBO_CAP - comboUsed;
        if (remainingCombo <= 0) gain = 0;
        else gain = Math.min(gain, remainingCombo);
      }

      let allowable = Math.min(gain, ROLE_INFO[role].caps - roleState[role].score);
      roleState[role].score += allowable;

      if (role === "班主任" || role === "副班主任") {
        const comboAfter = roleState["班主任"].score + roleState["副班主任"].score;
        if (comboAfter >= CLASS_VICE_COMBO_CAP - 1e-6) {
          roleState["班主任"].capped = true;
          roleState["副班主任"].capped = true;
        }
      }

      if (roleState[role].score >= ROLE_INFO[role].caps - 1e-6) {
        roleState[role].capped = true;
      }

      monthLog.allocations.push({ role, weight, gain: +allowable.toFixed(4) });
    }
    monthDetails.push(monthLog);
  }

  const roleSummary: RoleSummary[] = Object.keys(ROLE_INFO).map(r => ({ role: r as RoleKey, score: +roleState[r as RoleKey].score.toFixed(4), cap: ROLE_INFO[r as RoleKey].caps, capped: roleState[r as RoleKey].capped }));
  const totalScore = +roleSummary.reduce((s,r)=>s+r.score,0).toFixed(4);
  return { roleSummary, totalScore, monthDetails };
}

export default function TeacherScoreCalculator() {
  const [csvInput, setCsvInput] = useState(`"班主任","2006-09-01","2010-08-31"
"副班主任","2010-09-01","2011-08-31"
"班主任","2011-09-01","2016-08-31"
"年级组长","2014-09-01","2019-08-31"
"副班主任","2016-09-01","2020-08-31"
"科组长","2019-09-01","2024-12-31"
"班主任","2020-09-01","2021-08-31"
"中层干部","2021-06-01","2024-12-31"`);
  const [result, setResult] = useState<CalculationResult|null>(null);
  const [error, setError] = useState<string|null>(null);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // 检测系统主题偏好
  useEffect(() => {
    const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    setIsDarkMode(darkModeMediaQuery.matches);

    const handleChange = (e: MediaQueryListEvent) => {
      setIsDarkMode(e.matches);
    };

    darkModeMediaQuery.addEventListener('change', handleChange);
    return () => darkModeMediaQuery.removeEventListener('change', handleChange);
  }, []);

  const handleCalc = () => {
    setIsCalculating(true);
    setActiveStep(1);

    setTimeout(() => {
      try {
        setResult(calculate(csvInput));
        setError(null);
        setActiveStep(2);
      } catch(e:any) {
        setError(e.message);
        setResult(null);
        setActiveStep(0);
      } finally {
        setIsCalculating(false);
      }
    }, 800); // 添加延迟以显示计算过程
  };

  const handleExport = () => {
    if (!result) return;

    let csvContent = "岗位,得分,封顶分,状态\n";
    result.roleSummary.forEach(r => {
      csvContent += `${r.role},${r.score.toFixed(4)},${r.cap},${r.capped ? "已封顶" : "未封顶"}\n`;
    });

    csvContent += `\n总分,${result.totalScore.toFixed(4)},30,${result.totalScore >= 30 ? "已封顶" : "未封顶"}\n\n`;

    csvContent += "年月,分配详情\n";
    result.monthDetails.forEach(m => {
      csvContent += `${m.ym},${m.allocations.map(a => `${a.role} ${Math.round(a.weight*100)}% → ${a.gain.toFixed(4)}`).join("; ")}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `教师得分计算结果_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className={`min-h-screen transition-all duration-500 ${isDarkMode ? 'dark bg-gradient-to-br from-gray-900 via-blue-900 to-purple-900' : 'bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50'}`}>
      {/* Tailwind测试 - 这个应该是红色背景 */}
      <div className="bg-red-500 text-white p-2 text-center">
        Tailwind CSS 测试 - 如果你看到红色背景，说明样式正在工作！
      </div>

      {/* 顶部导航栏 */}
      <header className={`backdrop-blur-md border-b transition-all duration-300 sticky top-0 z-50 ${isDarkMode ? 'bg-gray-900/80 border-gray-700' : 'bg-white/80 border-gray-200'}`}>
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <div className={`p-2.5 rounded-xl ${isDarkMode ? 'bg-gradient-to-br from-blue-600 to-blue-700' : 'bg-gradient-to-br from-blue-500 to-blue-600'} shadow-lg`}>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.394 2.08a1 1 0 00-.788 0l-7 3a1 1 0 000 1.84L5.25 8.051a.999.999 0 01.356-.257l4-1.714a1 1 0 11.788 1.838L7.667 9.088l1.94.831a1 1 0 00.787 0l7-3a1 1 0 000-1.838l-7-3zM3.31 9.397L5 10.12v4.102a8.969 8.969 0 00-1.05-.174 1 1 0 01-.89-.89 11.115 11.115 0 01.25-3.762zM9.3 16.573A9.026 9.026 0 007 14.935v-3.957l1.818.78a3 3 0 002.364 0l5.508-2.361a11.026 11.026 0 01.25 3.762 1 1 0 01-.89.89 8.968 8.968 0 00-5.35 2.524 1 1 0 01-1.4 0zM6 18a1 1 0 001-1v-2.065a8.935 8.935 0 00-2-.712V17a1 1 0 001 1z" />
                </svg>
              </div>
              <div>
                <h1 className={`text-lg font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>教师管理岗位得分计算器</h1>
                <p className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>智能化管理类别得分计算系统</p>
              </div>
            </div>
            <Button
              variant="outline"
              onClick={() => setIsDarkMode(!isDarkMode)}
              className={`transition-all duration-300 ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-800' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
            >
              {isDarkMode ? '🌞 亮色模式' : '🌙 暗色模式'}
            </Button>
          </div>
        </div>
      </header>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* 进度指示器 */}
        <div className="mb-6">
          <div className="flex items-center justify-center space-x-4">
            {[
              { step: 0, title: "数据输入", icon: "📝" },
              { step: 1, title: "计算处理", icon: "⚡" },
              { step: 2, title: "结果展示", icon: "📊" }
            ].map((item, index) => (
              <div key={index} className="flex items-center">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full transition-all duration-300 text-sm ${
                  activeStep >= item.step
                    ? (isDarkMode ? 'bg-blue-600 text-white shadow-lg' : 'bg-blue-500 text-white shadow-lg')
                    : (isDarkMode ? 'bg-gray-700 text-gray-400' : 'bg-gray-200 text-gray-500')
                }`}>
                  {activeStep > item.step ? '✓' : item.icon}
                </div>
                <div className={`ml-2 ${activeStep >= item.step ? (isDarkMode ? 'text-white' : 'text-gray-900') : (isDarkMode ? 'text-gray-400' : 'text-gray-500')}`}>
                  <div className="text-sm font-medium">{item.title}</div>
                </div>
                {index < 2 && (
                  <div className={`w-12 h-0.5 mx-3 transition-all duration-300 ${
                    activeStep > item.step
                      ? (isDarkMode ? 'bg-blue-600' : 'bg-blue-500')
                      : (isDarkMode ? 'bg-gray-700' : 'bg-gray-300')
                  }`} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* 左右布局 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：数据输入区域 */}
          <div className="space-y-4">
            <Card className={`transition-all duration-300 shadow-xl hover:shadow-2xl ${isDarkMode ? 'bg-gray-800/50 border-gray-700 backdrop-blur-sm' : 'bg-white/70 border-gray-200 backdrop-blur-sm'}`}>
              <CardHeader className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                <CardTitle className={`flex items-center text-base ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                  <div className={`p-1.5 rounded-lg mr-2 ${isDarkMode ? 'bg-blue-600' : 'bg-blue-500'}`}>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </div>
                  岗位记录输入
                </CardTitle>
                <CardDescription className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                  请按照"岗位,开始日期,结束日期"格式输入，每行一条记录
                </CardDescription>
              </CardHeader>
              <CardContent className="p-4 space-y-4">
                {/* 岗位类型展示 */}
                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-gray-700/50' : 'bg-blue-50'}`}>
                  <h3 className={`text-sm font-medium mb-3 ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>支持的岗位类型</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(ROLE_INFO).map(([role, info]) => (
                      <div key={role} className={`flex items-center p-2 rounded-lg transition-all duration-200 hover:scale-102 ${isDarkMode ? 'bg-gray-600/50' : 'bg-white'} shadow-sm`}>
                        <div className={`w-2 h-2 rounded-full mr-2 ${info.color}`}></div>
                        <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>{role}</span>
                        <span className={`ml-auto text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>≤{info.caps}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 输入框 */}
                <div className="space-y-2">
                  <label className={`text-sm font-medium ${isDarkMode ? 'text-gray-200' : 'text-gray-700'}`}>
                    岗位数据 (CSV格式)
                  </label>
                  <Textarea
                    className={`min-h-[250px] lg:min-h-[300px] font-mono text-sm transition-all duration-300 resize-none ${
                      isDarkMode
                        ? 'bg-gray-700 text-white border-gray-600 focus:border-blue-500'
                        : 'bg-white text-gray-900 border-gray-300 focus:border-blue-500'
                    }`}
                    value={csvInput}
                    onChange={e => setCsvInput(e.target.value)}
                    placeholder='例如: "班主任","2006-09-01","2010-08-31"'
                  />
                </div>

                {/* 错误信息 */}
                {error && (
                  <div className={`p-3 rounded-xl border transition-all duration-300 ${
                    isDarkMode
                      ? 'bg-red-900/20 border-red-800 text-red-400'
                      : 'bg-red-50 border-red-200 text-red-600'
                  }`}>
                    <div className="flex items-start">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2 flex-shrink-0 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                      </svg>
                      <div>
                        <p className="text-sm font-medium">输入错误</p>
                        <p className="text-xs mt-1">{error}</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
              <CardFooter className={`border-t ${isDarkMode ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50/50'} p-4`}>
                <Button
                  onClick={handleCalc}
                  disabled={isCalculating}
                  className={`w-full transition-all duration-300 ${
                    isCalculating
                      ? 'opacity-70 cursor-not-allowed'
                      : 'hover:scale-105 hover:shadow-lg'
                  } ${isDarkMode ? 'bg-blue-600 hover:bg-blue-700' : 'bg-blue-500 hover:bg-blue-600'} text-white`}
                >
                  {isCalculating ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-3.5 w-3.5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      计算中...
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                      </svg>
                      开始计算
                    </>
                  )}
                </Button>
              </CardFooter>
            </Card>
          </div>

          {/* 右侧：结果展示区域 */}
          <div className="space-y-4">
            {result ? (
              <div className="space-y-4 animate-fade-in">
                {/* 总分卡片 */}
                <Card className={`transition-all duration-300 shadow-xl hover:shadow-2xl ${isDarkMode ? 'bg-gradient-to-br from-green-900/50 to-blue-900/50 border-green-700 backdrop-blur-sm' : 'bg-gradient-to-br from-green-50 to-blue-50 border-green-200 backdrop-blur-sm'}`}>
                  <CardHeader className="text-center">
                    <CardTitle className={`text-lg ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      管理类别总分
                    </CardTitle>
                    <div className={`text-3xl font-bold mt-2 ${result.totalScore >= 30 ? (isDarkMode ? 'text-green-400' : 'text-green-600') : (isDarkMode ? 'text-blue-400' : 'text-blue-600')}`}>
                      {result.totalScore.toFixed(4)}
                    </div>
                    <div className={`text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                      / 30.0000
                    </div>
                    <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium mt-2 ${
                      result.totalScore >= 30
                        ? (isDarkMode ? 'bg-green-900/30 text-green-400 border border-green-700' : 'bg-green-100 text-green-800 border border-green-200')
                        : (isDarkMode ? 'bg-blue-900/30 text-blue-400 border border-blue-700' : 'bg-blue-100 text-blue-800 border border-blue-200')
                    }`}>
                      {result.totalScore >= 30 ? '✓ 已达封顶' : '⏳ 未达封顶'}
                    </div>
                  </CardHeader>
                  <CardFooter className="justify-center">
                    <Button
                      variant="outline"
                      onClick={handleExport}
                      className={`transition-all duration-300 hover:scale-105 ${isDarkMode ? 'border-gray-600 text-gray-300 hover:bg-gray-700' : 'border-gray-300 text-gray-700 hover:bg-gray-100'}`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      导出结果
                    </Button>
                  </CardFooter>
                </Card>

                {/* 岗位得分汇总 */}
                <Card className={`transition-all duration-300 shadow-xl hover:shadow-2xl ${isDarkMode ? 'bg-gray-800/50 border-gray-700 backdrop-blur-sm' : 'bg-white/70 border-gray-200 backdrop-blur-sm'}`}>
                  <CardHeader className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <CardTitle className={`flex items-center text-base ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      <div className={`p-1.5 rounded-lg mr-2 ${isDarkMode ? 'bg-purple-600' : 'bg-purple-500'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                        </svg>
                      </div>
                      岗位得分汇总
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="space-y-2 p-4">
                      {result.roleSummary.map((r) => (
                        <div key={r.role} className={`p-3 rounded-xl transition-all duration-300 hover:scale-102 ${isDarkMode ? 'bg-gray-700/50 hover:bg-gray-700' : 'bg-gray-50 hover:bg-gray-100'}`}>
                          <div className="flex items-center justify-between">
                            <div className="flex items-center">
                              <div className={`w-3 h-3 rounded-full mr-2 ${ROLE_INFO[r.role].color}`}></div>
                              <div>
                                <div className={`text-sm font-medium ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{r.role}</div>
                                <div className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                  {r.score.toFixed(4)} / {r.cap}
                                </div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                {((r.score / r.cap) * 100).toFixed(1)}%
                              </div>
                              <div className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium ${
                                r.capped
                                  ? (isDarkMode ? 'bg-green-900/30 text-green-400' : 'bg-green-100 text-green-800')
                                  : (isDarkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-800')
                              }`}>
                                {r.capped ? '已封顶' : '未封顶'}
                              </div>
                            </div>
                          </div>
                          {/* 进度条 */}
                          <div className={`mt-2 h-1.5 rounded-full overflow-hidden ${isDarkMode ? 'bg-gray-600' : 'bg-gray-200'}`}>
                            <div
                              className={`h-full transition-all duration-1000 ease-out ${ROLE_INFO[r.role].color}`}
                              style={{ width: `${Math.min((r.score / r.cap) * 100, 100)}%` }}
                            ></div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* 逐月权重分配明细 */}
                <Card className={`transition-all duration-300 shadow-xl hover:shadow-2xl ${isDarkMode ? 'bg-gray-800/50 border-gray-700 backdrop-blur-sm' : 'bg-white/70 border-gray-200 backdrop-blur-sm'}`}>
                  <CardHeader className={`border-b ${isDarkMode ? 'border-gray-700' : 'border-gray-200'}`}>
                    <CardTitle className={`flex items-center text-base ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                      <div className={`p-1.5 rounded-lg mr-2 ${isDarkMode ? 'bg-indigo-600' : 'bg-indigo-500'}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                        </svg>
                      </div>
                      逐月权重分配明细
                    </CardTitle>
                    <CardDescription className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>
                      显示每月的岗位权重分配和得分增长详情
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ScrollArea className="h-[300px] lg:h-[400px]">
                      <div className="p-4 space-y-3">
                        {result.monthDetails.map((m) => (
                          <div key={m.ym} className={`p-3 rounded-xl transition-all duration-300 hover:scale-102 ${isDarkMode ? 'bg-gray-700/30 hover:bg-gray-700/50' : 'bg-gray-50 hover:bg-gray-100'}`}>
                            <div className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                              📅 {m.ym}
                            </div>
                            <div className="space-y-1.5">
                              {m.allocations.map((a, idx) => (
                                <div key={idx} className="flex items-center justify-between">
                                  <div className="flex items-center">
                                    <div className={`w-2 h-2 rounded-full mr-2 ${ROLE_INFO[a.role].color}`}></div>
                                    <span className={`text-xs ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                                      {a.role}
                                    </span>
                                  </div>
                                  <div className="flex items-center space-x-1.5">
                                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${isDarkMode ? 'bg-blue-900/30 text-blue-400' : 'bg-blue-100 text-blue-800'}`}>
                                      {Math.round(a.weight * 100)}%
                                    </span>
                                    <span className={`text-xs font-medium ${isDarkMode ? 'text-green-400' : 'text-green-600'}`}>
                                      +{a.gain.toFixed(4)}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            ) : (
              <div className={`text-center py-12 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                <div className={`w-16 h-16 mx-auto mb-4 rounded-full flex items-center justify-center ${isDarkMode ? 'bg-gray-700' : 'bg-gray-200'}`}>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
                <h3 className={`text-base font-medium mb-2 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                  等待计算结果
                </h3>
                <p className="text-sm">
                  请在左侧输入岗位数据并点击"开始计算"按钮
                </p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
