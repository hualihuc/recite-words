import React, { useState, useEffect, useRef } from 'react';
import { Camera, ArrowRight, Check, X, RotateCcw, BookOpen, Brain, Sparkles, Volume2, History, Flame, FileText, Trash2, ListChecks, Upload, Calendar, CalendarClock, Layers, ArrowLeft, Database, CheckCircle2, List, Settings } from 'lucide-react';

const SILICONFLOW_API_BASE = 'https://api.siliconflow.cn/v1/chat/completions';
const TEXT_MODEL = 'deepseek-ai/DeepSeek-V3';
const OCR_MODEL = 'PaddlePaddle/PaddleOCR-VL-1.5'

export default function App() {
  const [appState, setAppState] = useState('home');
  const [flowType, setFlowType] = useState('free');
  const [listType, setListType] = useState('');
  const [wordList, setWordList] = useState([]);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [incorrectWords, setIncorrectWords] = useState([]);
  const [showMeaning, setShowMeaning] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [planData, setPlanData] = useState(null);
  const [activePlanDay, setActivePlanDay] = useState(1);
  const [reviewBook, setReviewBook] = useState([]);
  const [planSetupDays, setPlanSetupDays] = useState(7);
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [tempApiKey, setTempApiKey] = useState('');
  const [revealedRecent, setRevealedRecent] = useState([]);
  const [revealedSticky, setRevealedSticky] = useState([]);
  const [dismissedA4, setDismissedA4] = useState([]);
  const [stickyWords, setStickyWords] = useState([]);
  const fileInputRef = useRef(null);
  const docInputRef = useRef(null);

  useEffect(() => {
    if (!window.XLSX) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
    if (!window.mammoth) {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
      script.async = true;
      document.body.appendChild(script);
    }
    try {
      const savedPlan = localStorage.getItem('ai_english_plan');
      if (savedPlan) {
        let p = JSON.parse(savedPlan);
        if (p.currentDay !== undefined && !p.completedDays) {
          p.completedDays = Array.from({ length: p.currentDay - 1 }, (_, i) => i + 1);
          delete p.currentDay;
        }
        setPlanData(p);
      }
      const savedReviewBook = localStorage.getItem('ai_english_review_book');
      if (savedReviewBook) setReviewBook(JSON.parse(savedReviewBook));
      const savedKey = localStorage.getItem('siliconflow_api_key');
      if (savedKey) setApiKey(savedKey);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const saveApiKey = (key) => {
    setApiKey(key);
    localStorage.setItem('siliconflow_api_key', key);
    setShowSettings(false);
    setTempApiKey('');
  };

  const openSettings = () => {
    setTempApiKey(apiKey);
    setShowSettings(true);
  };

  const addToReviewBook = (wordObj) => {
    setReviewBook(prev => {
      if (prev.find(w => w.word === wordObj.word)) return prev;
      const updated = [...prev, wordObj];
      localStorage.setItem('ai_english_review_book', JSON.stringify(updated));
      return updated;
    });
  };

  const savePlanToLocal = (plan) => {
    setPlanData(plan);
    localStorage.setItem('ai_english_plan', JSON.stringify(plan));
  };

  const clearPlan = () => {
    if (window.confirm('确定要放弃当前的背词计划吗？')) {
      setPlanData(null);
      localStorage.removeItem('ai_english_plan');
    }
  };

  const playAudio = (text) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      let speakText = text.replace(/🟰/g, ' equals ').replace(/➕/g, ' plus ').replace(/=/g, ' equals ').replace(/vs/gi, ' versus ');
      const utterance = new SpeechSynthesisUtterance(speakText);
      utterance.lang = 'en-US';
      utterance.rate = 0.85;
      window.speechSynthesis.speak(utterance);
    }
  };

  useEffect(() => {
    if (appState === 'learning' && wordList[currentWordIndex] && !isReviewing) {
      playAudio(wordList[currentWordIndex].word);
    }
  }, [appState, currentWordIndex, wordList, isReviewing]);

  const fileToBase64 = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  };

  const readTxtFile = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsText(file, 'UTF-8');
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });
  };

  const analyzeContent = async (type, contentData, mimeType = null) => {
    setAppState('analyzing');
    setErrorMessage('');
    if (!apiKey) {
      setErrorMessage('请先设置硅基流动 API Key（点击右上角⚙️）');
      setAppState('upload');
      return;
    }
    try {
      const systemPrompt = `你现在是一位极其精准的内容提取专家。请从输入的内容中，完整提取出【所有的英语学习条目】！
      严格遵守以下要求：
      1. 全面提取，绝不漏词。包含单词、词组、句型、以及A=B的同义替换等。
      2. 数据结构拆分：
         - 'word': 填入纯英文内容（保留等号等特殊连接符）。
         - 'definitions': 这是一个【数组】。如果一个词有多个词性/意思，请拆分为多个对象放入数组！
             - 'pos': 词性缩写（如句式、短语或无特定词性，务必留空 ""）。
             - 'meaning': 中文释义或考点（不含词性）。
         - 'explanation': 简短生动的【记忆法或考点解析】。
      如果不包含任何合法的英语学习内容，返回空数组 []。
      请仅输出一个 JSON 数组，不要有任何额外文本或注释。`;

      let model = TEXT_MODEL;
      let messages = [];
      if (type === 'image') {
        model = OCR_MODEL;
        messages = [
          {
            role: 'user',
            content: [
              { type: 'text', text: systemPrompt + ' 请识别图片中的文字内容并提取学习条目。' },
              {
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${contentData}` }
              }
            ]
          }
        ];
      } else {
        messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: '以下是需要提取的文本内容：\n' + contentData }
        ];
      }
      const payload = {
        model: model,
        messages: messages,
        temperature: 0.2,
      };
      let result = null;
      let attempt = 0;
      const maxRetries = 3;
      const delays = [1000, 2000, 4000];
      while (attempt < maxRetries) {
        try {
          const response = await fetch(SILICONFLOW_API_BASE, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(payload)
          });
          if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || 'API请求失败');
          }
          const data = await response.json();
          const content = data.choices[0].message.content;

          // ========== 增强的 JSON 解析（修复图片识别问题） ==========
          const trimmed = content.trim();
          // 检查是否以 { 或 [ 开头（JSON 对象或数组）
          if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
            throw new Error('AI 返回了非 JSON 格式内容：' + trimmed.substring(0, 200));
          }

          let cleaned = trimmed.replace(/```json/gi, '').replace(/```/g, '').trim();
          // 尝试匹配 JSON 数组
          let match = cleaned.match(/\[\s*\{[\s\S]*\}\s*\]/);
          if (!match) {
            match = cleaned.match(/\{[\s\S]*\}/);
          }
          if (match) {
            cleaned = match[0];
          }

          let parsed;
          try {
            parsed = JSON.parse(cleaned);
          } catch (e) {
            console.error('JSON 解析失败，原始内容：', content);
            throw new Error('无法解析 AI 返回的数据，请确保图片清晰且包含英文单词。原始片段：' + content.substring(0, 300));
          }

          if (Array.isArray(parsed)) {
            result = parsed;
          } else if (parsed.data && Array.isArray(parsed.data)) {
            result = parsed.data;
          } else if (parsed.result && Array.isArray(parsed.result)) {
            result = parsed.result;
          } else {
            result = [parsed];
          }
          break;
        } catch (error) {
          attempt++;
          if (attempt >= maxRetries) throw error;
          await new Promise(resolve => setTimeout(resolve, delays[attempt - 1]));
        }
      }
      if (result && result.length > 0) {
        setWordList(result);
        setCurrentWordIndex(0);
        resetLearningStates();
        setAppState('confirming');
      } else {
        setErrorMessage('未能提取到清晰的学习条目，请检查内容。');
        setAppState('upload');
      }
    } catch (error) {
      setErrorMessage('解析失败: ' + error.message);
      setAppState('upload');
    }
  };

  const handleImageUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length > 0) {
      setAppState('analyzing');
      setErrorMessage('');
      try {
        const file = files[0];
        const base64String = await fileToBase64(file);
        const base64Data = base64String.split(',')[1];
        await analyzeContent('image', base64Data, file.type);
      } catch (err) {
        setErrorMessage('图片读取失败，请重试。');
        setAppState('upload');
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDocumentUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const fileName = file.name.toLowerCase();
      let textContent = '';
      if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        if (!window.XLSX) return setErrorMessage('组件加载中，请稍后。');
        const arrayBuffer = await file.arrayBuffer();
        const workbook = window.XLSX.read(arrayBuffer, { type: 'array' });
        workbook.SheetNames.forEach(sheetName => {
          textContent += window.XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]) + '\n';
        });
      } else if (fileName.endsWith('.docx')) {
        if (!window.mammoth) return setErrorMessage('组件加载中，请稍后。');
        const arrayBuffer = await file.arrayBuffer();
        const result = await window.mammoth.extractRawText({ arrayBuffer });
        textContent = result.value;
      } else {
        textContent = await readTxtFile(file);
      }
      await analyzeContent('text', textContent.substring(0, 10000));
    } catch (err) {
      setErrorMessage('文档读取失败。');
    }
    if (docInputRef.current) docInputRef.current.value = '';
  };

  const resetLearningStates = () => {
    setIncorrectWords([]);
    setShowMeaning(false);
    setRevealedRecent([]);
    setRevealedSticky([]);
    setDismissedA4([]);
    setStickyWords([]);
  };

  const handleRemoveWord = (indexToRemove) => {
    setWordList(wordList.filter((_, idx) => idx !== indexToRemove));
  };

  const proceedFromConfirming = () => {
    if (wordList.length === 0) {
      setErrorMessage('清单已空，请重新上传。');
      setAppState('upload');
      return;
    }
    if (flowType === 'free') {
      setAppState('learning');
    } else if (flowType === 'plan_create') {
      setAppState('plan_setup');
    } else if (flowType === 'review_import') {
      setAppState('flashcard');
    }
  };

  const createPlan = () => {
    const plan = {
      id: Date.now(),
      words: wordList,
      days: planSetupDays,
      completedDays: [],
      wordsPerDay: Math.ceil(wordList.length / planSetupDays)
    };
    savePlanToLocal(plan);
    setAppState('home');
  };

  const startDailyPlan = (dayNum) => {
    const startIdx = (dayNum - 1) * planData.wordsPerDay;
    const endIdx = startIdx + planData.wordsPerDay;
    const todaysWords = planData.words.slice(startIdx, endIdx);
    if (todaysWords.length === 0) {
      alert('这一天的任务已经没有单词啦！');
      return;
    }
    setActivePlanDay(dayNum);
    setFlowType('plan_daily');
    setWordList(todaysWords);
    setCurrentWordIndex(0);
    resetLearningStates();
    setAppState('learning');
  };

  const finishDailyPlan = () => {
    let updatedCompleted = [...(planData.completedDays || [])];
    if (!updatedCompleted.includes(activePlanDay)) {
      updatedCompleted.push(activePlanDay);
    }
    const updatedPlan = { ...planData, completedDays: updatedCompleted };
    savePlanToLocal(updatedPlan);
    setAppState('home');
  };

  const handleNextLearn = () => {
    if (currentWordIndex < wordList.length - 1) {
      setCurrentWordIndex(prev => prev + 1);
      setShowMeaning(false);
      setRevealedRecent([]);
      setRevealedSticky([]);
    } else {
      setCurrentWordIndex(0);
      setShowMeaning(false);
      setRevealedRecent([]);
      setRevealedSticky([]);
      setDismissedA4([]);
      setStickyWords([]);
      setAppState('testing');
    }
  };

  const toggleRecentWordReveal = (i) => { if (!revealedRecent.includes(i)) setRevealedRecent([...revealedRecent, i]); };
  const toggleStickyWordReveal = (i) => { if (!revealedSticky.includes(i)) setRevealedSticky([...revealedSticky, i]); };
  const markAsRemembered = (i) => { if (!dismissedA4.includes(i)) setDismissedA4([...dismissedA4, i]); setStickyWords(stickyWords.filter(x => x !== i)); };
  const markAsSticky = (i) => { if (!stickyWords.includes(i)) setStickyWords([...stickyWords, i]); };

  const handleTestResult = (knewIt) => {
    if (!knewIt) {
      setIncorrectWords(prev => [...prev, wordList[currentWordIndex]]);
      addToReviewBook(wordList[currentWordIndex]);
    }
    if (currentWordIndex < wordList.length - 1) {
      setCurrentWordIndex(prev => prev + 1);
      setShowMeaning(false);
    } else {
      setAppState('results');
    }
  };

  const startReviewMistakes = () => {
    setWordList([...incorrectWords]);
    setCurrentWordIndex(0);
    resetLearningStates();
    setIsReviewing(true);
    setAppState('learning');
  };

  const goHome = () => {
    setAppState('home');
    setWordList([]);
    resetLearningStates();
  };

  const startReviewBook = () => {
    if (reviewBook.length === 0) {
      alert('生词本为空哦，先去背几组单词积累一下吧！');
      return;
    }
    const shuffled = [...reviewBook].sort(() => 0.5 - Math.random());
    setFlowType('review_book');
    setWordList(shuffled);
    setCurrentWordIndex(0);
    setShowMeaning(false);
    setAppState('flashcard');
  };

  const handleFlashcardSwipe = (knewIt) => {
    const currentWord = wordList[currentWordIndex];
    if (!knewIt) {
      addToReviewBook(currentWord);
    } else if (flowType === 'review_book') {
      const newBook = reviewBook.filter(w => w.word !== currentWord.word);
      setReviewBook(newBook);
      localStorage.setItem('ai_english_review_book', JSON.stringify(newBook));
    }
    if (currentWordIndex < wordList.length - 1) {
      setCurrentWordIndex(prev => prev + 1);
      setShowMeaning(false);
    } else {
      alert('这组卡片复习完了！继续保持！');
      goHome();
    }
  };

  const viewWordList = (type) => {
    setListType(type);
    setAppState('word_list');
  };

  const deleteFromReviewBook = (index) => {
    const newBook = reviewBook.filter((_, i) => i !== index);
    setReviewBook(newBook);
    localStorage.setItem('ai_english_review_book', JSON.stringify(newBook));
  };

  // ========== 粉色主题渲染组件 ==========

  const renderHome = () => (
    <div className="flex flex-col items-center w-full max-w-md mx-auto py-8 space-y-8 animate-in fade-in">
      <div className="w-full flex justify-between items-center px-4">
        <div className="text-center space-y-2 mt-4 flex-1">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-pink-400 via-rose-400 to-purple-400 text-white rounded-3xl mb-4 shadow-xl shadow-pink-200 transform rotate-3 hover:rotate-6 transition-transform duration-300">
            <Brain size={40} className="-rotate-3" />
          </div>
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-pink-500 via-rose-400 to-purple-400 text-transparent bg-clip-text tracking-tight">
            🌸 全能背词神器
          </h1>
          <p className="text-sm text-gray-600 font-medium flex items-center justify-center gap-1">
            <Sparkles size={14} className="text-pink-400" /> 定制计划 · 极速复习 · AI解析 <Sparkles size={14} className="text-pink-400" />
          </p>
        </div>
        <button onClick={openSettings} className="p-3 bg-white/80 backdrop-blur-sm rounded-full shadow-md hover:shadow-lg transition-all hover:scale-110 border border-pink-200">
          <Settings size={24} className="text-pink-500" />
        </button>
      </div>

      {!apiKey && (
        <div className="w-full bg-gradient-to-r from-pink-50 to-rose-50 border border-pink-200 rounded-xl p-4 text-center text-sm text-pink-800 shadow-md animate-pulse">
          ⚠️ 请先点击右上角 ⚙️ 设置硅基流动 API Key（免费）
        </div>
      )}

      <div className="w-full space-y-4 px-2">
        <div className="bg-gradient-to-br from-pink-50 to-rose-50 p-5 rounded-3xl shadow-md border border-pink-100 flex flex-col relative overflow-hidden group hover:shadow-xl transition-shadow duration-300">
          <div className="absolute top-0 right-0 w-40 h-40 bg-gradient-to-br from-pink-200 to-rose-200 rounded-full blur-3xl opacity-40 -mr-10 -mt-10"></div>
          <div className="flex items-center justify-between mb-2 relative z-10 w-full">
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-gradient-to-br from-pink-400 to-rose-500 text-white rounded-xl shadow-md"><CalendarClock size={24} /></div>
              <div>
                <h3 className="font-bold text-lg text-gray-800">📚 学习计划库</h3>
                <p className="text-xs text-gray-500">点选任意一天，直接开背</p>
              </div>
            </div>
            {planData && (
              <button onClick={() => viewWordList('plan')} className="p-2 text-pink-600 hover:bg-pink-100 rounded-xl transition-colors active:scale-95 flex flex-col items-center">
                <List size={22} />
              </button>
            )}
          </div>
          {planData ? (
            <div className="relative z-10 w-full mt-2">
              <div className="flex justify-between items-center mb-3">
                <span className="text-sm font-bold text-pink-600">🔥 打卡进度: {(planData.completedDays||[]).length} / {planData.days} 天</span>
                <span className="text-xs text-gray-500 bg-white/60 px-2 py-1 rounded-full shadow">共 {planData.words.length} 词</span>
              </div>
              <div className="grid grid-cols-5 gap-2 mb-4 max-h-40 overflow-y-auto pr-1">
                {Array.from({length: planData.days}, (_, i) => i + 1).map(dayNum => {
                  const isCompleted = (planData.completedDays||[]).includes(dayNum);
                  return (
                    <button key={dayNum} onClick={() => startDailyPlan(dayNum)} className={`py-2 rounded-xl text-sm font-bold flex flex-col items-center justify-center transition-all shadow-sm active:scale-95 ${isCompleted ? 'bg-gradient-to-br from-green-400 to-emerald-500 text-white shadow-green-200' : 'bg-white/70 text-gray-600 hover:bg-pink-100 hover:text-pink-600 border border-gray-200 hover:border-pink-300'}`}>
                      <span className="text-[10px] font-medium opacity-80">Day</span>
                      <span>{dayNum}</span>
                    </button>
                  );
                })}
              </div>
              <div className="flex justify-end">
                <button onClick={clearPlan} className="text-xs text-red-400 hover:text-red-500 underline underline-offset-2">放弃计划</button>
              </div>
            </div>
          ) : (
            <button onClick={() => { setFlowType('plan_create'); setAppState('upload'); }} className="w-full bg-gradient-to-r from-pink-400 to-rose-500 hover:from-pink-500 hover:to-rose-600 text-white py-3.5 rounded-xl font-bold transition-all shadow-lg shadow-pink-200 relative z-10 mt-2">
              ✨ 导入词库并制定计划
            </button>
          )}
        </div>

        <button onClick={() => { setFlowType('free'); setAppState('upload'); }} className="w-full bg-gradient-to-br from-pink-50 to-purple-50 p-5 rounded-3xl shadow-md border border-pink-100 flex items-center justify-between hover:shadow-xl transition-all group">
          <div className="flex items-center gap-3 text-left">
            <div className="p-2.5 bg-gradient-to-br from-pink-400 to-purple-400 text-white rounded-xl shadow-md"><Layers size={24} /></div>
            <div>
              <h3 className="font-bold text-lg text-gray-800">🚀 自由带背</h3>
              <p className="text-xs text-gray-500">拍多页/传文档，不设限</p>
            </div>
          </div>
          <ArrowRight className="text-pink-400 group-hover:text-pink-600 transition-colors" />
        </button>

        <div className="w-full bg-gradient-to-br from-rose-50 to-amber-50 p-5 rounded-3xl shadow-md border border-rose-100 flex flex-col gap-3">
          <div className="flex items-center justify-between mb-1 w-full">
            <div className="flex items-center gap-3 text-left">
              <div className="p-2.5 bg-gradient-to-br from-rose-400 to-orange-400 text-white rounded-xl shadow-md"><History size={24} /></div>
              <div>
                <h3 className="font-bold text-lg text-gray-800">⚡ 极速复习 (卡片模式)</h3>
                <p className="text-xs text-gray-500">滑动卡片，筛出核心盲区</p>
              </div>
            </div>
            {reviewBook.length > 0 && (
              <button onClick={() => viewWordList('review')} className="p-2 text-rose-600 hover:bg-rose-100 rounded-xl transition-colors active:scale-95">
                <List size={22} />
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={startReviewBook} className="flex-1 flex flex-col items-center justify-center py-3 bg-gradient-to-br from-rose-400 to-orange-400 hover:from-rose-500 hover:to-orange-500 text-white rounded-xl shadow transition-all">
              <Database size={20} className="mb-1" />
              <span className="text-sm font-bold">复习生词本</span>
              <span className="text-[10px] opacity-80">{reviewBook.length}词</span>
            </button>
            <button onClick={() => { setFlowType('review_import'); setAppState('upload'); }} className="flex-1 flex flex-col items-center justify-center py-3 bg-white/80 hover:bg-white rounded-xl border border-rose-200 transition-colors">
              <Upload size={20} className="text-rose-500 mb-1" />
              <span className="text-sm font-bold text-gray-700">导入新资料</span>
              <span className="text-[10px] text-gray-400">一键解析</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  const renderUpload = () => (
    <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto py-8 space-y-6">
      <div className="w-full flex justify-start mb-2">
        <button onClick={goHome} className="flex items-center gap-1 text-gray-500 hover:text-pink-600 transition-colors">
          <ArrowLeft size={20} /> 返回首页
        </button>
      </div>
      <div className="text-center space-y-2 mb-4">
        <h2 className="text-2xl font-bold text-gray-800">
          {flowType === 'plan_create' ? '🌸 导入词库建计划' : flowType === 'review_import' ? '🌸 导入资料极速复习' : '🌸 导入资料自由带背'}
        </h2>
        <p className="text-gray-500 text-sm">支持 拍照/相册 或 文档（TXT/Excel/Word）</p>
      </div>
      {errorMessage && <div className="w-full p-4 bg-red-50 text-red-600 rounded-xl text-sm text-center animate-in fade-in">{errorMessage}</div>}
      <div className="w-full space-y-4">
        <label className="w-full flex items-center justify-center gap-3 bg-gradient-to-r from-pink-400 to-rose-500 hover:from-pink-500 hover:to-rose-600 text-white p-5 rounded-2xl font-medium transition-colors shadow-lg shadow-pink-200 cursor-pointer active:scale-[0.98]">
          <Camera size={24} /><span>拍照 / 多图上传</span>
          <input type="file" accept="image/*" multiple className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
        </label>
        <div className="flex items-center w-full py-2">
          <div className="flex-1 border-t border-gray-200"></div><span className="px-4 text-sm text-gray-400">或者导入文档</span><div className="flex-1 border-t border-gray-200"></div>
        </div>
        <label className="w-full flex items-center justify-center gap-3 bg-white border-2 border-pink-400 text-pink-600 hover:bg-pink-50 p-5 rounded-2xl font-medium transition-colors cursor-pointer active:scale-[0.98]">
          <Upload size={24} /><span>导入 笔记文档 (全格式)</span>
          <input type="file" accept=".txt,.xlsx,.xls,.csv,.docx" className="hidden" ref={docInputRef} onChange={handleDocumentUpload} />
        </label>
      </div>
    </div>
  );

  const renderAnalyzing = () => (
    <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto min-h-[60vh] space-y-6">
      <div className="relative"><div className="absolute inset-0 bg-pink-200 rounded-full animate-ping opacity-75"></div><div className="relative bg-white p-4 rounded-full shadow-lg"><Sparkles className="text-pink-500 animate-pulse" size={40} /></div></div>
      <h2 className="text-xl font-bold text-gray-800 mt-4">🌸 正在智能梳理内容...</h2>
      <p className="text-gray-500 text-center text-sm">AI正在处理文件，如果是多页图片，<br/>将会为您融合提取，这可能需要一点时间。</p>
    </div>
  );

  const renderConfirming = () => (
    <div className="flex flex-col items-center w-full max-w-md mx-auto py-6 min-h-screen">
      <div className="w-full text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 bg-pink-100 text-pink-600 rounded-full mb-3"><ListChecks size={24} /></div>
        <h2 className="text-xl font-bold text-gray-800">🌸 核对内容清单</h2>
        <p className="text-sm text-gray-500 mt-1">共识别 {wordList.length} 个条目，可删除不需要的项。</p>
      </div>
      <div className="w-full flex-1 bg-white rounded-2xl shadow-sm border border-gray-200 p-4 mb-6 overflow-y-auto max-h-[50vh]">
        {wordList.length === 0 ? <div className="text-center text-gray-400 py-10">清单已空</div> : (
          <ul className="space-y-3">
            {wordList.map((word, idx) => (
              <li key={idx} className="flex justify-between items-start p-3 bg-pink-50/50 rounded-xl border border-pink-100">
                <div className="flex flex-col flex-1 min-w-0 pr-4">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="font-bold text-gray-800 text-base break-words whitespace-pre-wrap">{word.word}</span>
                    <button onClick={() => playAudio(word.word)} className="text-gray-400 hover:text-pink-500"><Volume2 size={16}/></button>
                  </div>
                  <div className="flex flex-col gap-1">
                    {(word.definitions || []).map((def, defIdx) => (
                      <div key={defIdx} className="text-xs text-gray-600 flex items-start">
                        {def.pos && <span className="inline-block bg-pink-100 text-pink-700 text-[10px] font-bold px-1.5 py-0.5 rounded mr-1.5 mt-0.5 shrink-0">{def.pos}</span>}
                        <span className="break-words line-clamp-2" title={def.meaning}>{def.meaning}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <button onClick={() => handleRemoveWord(idx)} className="p-2 text-gray-400 hover:text-red-500"><Trash2 size={18} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="w-full space-y-3">
        <button onClick={proceedFromConfirming} disabled={wordList.length===0} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-400 to-rose-500 hover:from-pink-500 hover:to-rose-600 text-white p-4 rounded-2xl font-bold transition-all shadow-lg shadow-pink-200 disabled:opacity-50">
          <Check size={20} />
          {flowType === 'plan_create' ? '去设定天数计划！' : flowType === 'review_import' ? '去极速复习！' : '开始自由带背！'}
        </button>
        <button onClick={() => setAppState('upload')} className="w-full p-4 rounded-2xl font-medium bg-gray-100 text-gray-600 hover:bg-gray-200">重新上传</button>
      </div>
    </div>
  );

  const renderWordList = () => {
    const list = listType === 'plan' ? (planData?.words || []) : reviewBook;
    const isPlan = listType === 'plan';
    const themeBg = isPlan ? 'bg-pink-100' : 'bg-rose-100';
    const themeText = isPlan ? 'text-pink-700' : 'text-rose-700';
    const themeHover = isPlan ? 'hover:text-pink-500' : 'hover:text-rose-500';
    return (
      <div className="flex flex-col items-center w-full max-w-md mx-auto py-6 min-h-screen animate-in fade-in">
        <div className="w-full flex justify-between items-center mb-6 px-2">
          <button onClick={goHome} className="flex items-center gap-1 text-gray-500 hover:text-pink-600 bg-gray-100 px-3 py-1.5 rounded-full transition-colors">
            <ArrowLeft size={16} /> 返回
          </button>
        </div>
        <div className="w-full text-center mb-6">
          <h2 className="text-2xl font-extrabold text-gray-800">{isPlan ? '🌸 计划总词库' : '🌸 我的生词本'}</h2>
          <p className="text-sm text-gray-500 mt-1">共收录 {list.length} 个条目</p>
        </div>
        <div className="w-full flex-1 bg-white rounded-[2rem] shadow-sm border border-gray-200 p-4 mb-6 overflow-y-auto max-h-[70vh]">
          {list.length === 0 ? <div className="text-center text-gray-400 py-10">列表为空</div> : (
            <ul className="space-y-4">
              {list.map((word, idx) => (
                <li key={idx} className="flex justify-between items-start p-3 bg-pink-50/50 rounded-xl border border-pink-100 transition-colors">
                  <div className="flex flex-col flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-bold text-gray-800 text-base break-words whitespace-pre-wrap">{word.word}</span>
                      <button onClick={() => playAudio(word.word)} className={`text-gray-400 ${themeHover}`}><Volume2 size={16}/></button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {(word.definitions || []).map((def, defIdx) => (
                        <div key={defIdx} className="text-sm text-gray-600 flex items-start">
                          {def.pos && <span className={`inline-block ${themeBg} ${themeText} text-[10px] font-bold px-1.5 py-0.5 rounded mr-2 mt-0.5 shrink-0`}>{def.pos}</span>}
                          <span className="break-words leading-snug">{def.meaning}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {!isPlan && (
                    <button onClick={() => deleteFromReviewBook(idx)} className="p-2 text-gray-400 hover:text-red-500 bg-white border border-gray-100 rounded-lg shadow-sm active:scale-95 shrink-0 mt-1" title="已掌握，从生词本剔除">
                      <Trash2 size={16} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  const renderPlanSetup = () => (
    <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto py-10 min-h-[70vh]">
      <div className="w-full bg-white p-8 rounded-3xl shadow-xl border border-pink-100 text-center space-y-8 animate-in fade-in zoom-in-95">
        <div className="inline-flex p-4 bg-pink-50 text-pink-600 rounded-full mb-2"><Calendar size={40} /></div>
        <div>
          <h2 className="text-2xl font-extrabold text-gray-800 mb-2">🌸 制定学习计划</h2>
          <p className="text-gray-500 text-sm">当前词库共 <span className="font-bold text-pink-600 text-lg">{wordList.length}</span> 个条目</p>
        </div>
        <div className="space-y-4 py-4">
          <label className="block text-sm font-bold text-gray-700 text-left">你想在几天内学完？</label>
          <div className="flex items-center gap-4">
            <input type="range" min="1" max="30" value={planSetupDays} onChange={(e)=>setPlanSetupDays(parseInt(e.target.value))} className="w-full accent-pink-500" />
            <span className="font-bold text-xl text-pink-600 w-12">{planSetupDays} 天</span>
          </div>
          <div className="bg-pink-50 p-4 rounded-xl flex justify-between items-center text-pink-800">
            <span className="font-medium text-sm">每日任务量：</span>
            <span className="font-extrabold text-xl">{Math.ceil(wordList.length / planSetupDays)} 词/天</span>
          </div>
        </div>
        <button onClick={createPlan} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-pink-400 to-rose-500 hover:from-pink-500 hover:to-rose-600 text-white p-4 rounded-2xl font-bold text-lg shadow-lg shadow-pink-200">
          <CheckCircle2 size={24} /> 确认生成专属计划
        </button>
      </div>
    </div>
  );

  const renderFlashcardMode = () => {
    const currentWord = wordList[currentWordIndex];
    if (!currentWord) return null;
    const wordLength = currentWord.word?.length || 0;
    const wordFontSizeClass = wordLength > 30 ? 'text-2xl' : (wordLength > 15 ? 'text-3xl' : 'text-5xl');
    return (
      <div className="flex flex-col items-center w-full max-w-md mx-auto py-6 min-h-screen">
        <div className="w-full flex justify-between items-center mb-6">
          <button onClick={goHome} className="text-gray-400 hover:text-pink-600"><X size={24} /></button>
          <span className="text-sm font-bold text-pink-600 bg-pink-50 px-4 py-1.5 rounded-full border border-pink-200">
            🌸 极速复习 {currentWordIndex + 1} / {wordList.length}
          </span>
          <div className="w-6"></div>
        </div>
        <div className="flex-1 w-full flex flex-col justify-center pb-10 perspective-1000">
          <div onClick={() => setShowMeaning(true)} className="w-full bg-white rounded-[2.5rem] shadow-2xl border border-pink-100 p-8 flex flex-col items-center justify-center min-h-[400px] relative overflow-hidden transition-all duration-300 cursor-pointer active:scale-95">
            <button onClick={(e)=>{e.stopPropagation(); playAudio(currentWord.word)}} className="absolute top-6 right-6 p-2 text-gray-400 hover:text-pink-500 bg-gray-50 rounded-full"><Volume2 size={20}/></button>
            <h2 className={`font-extrabold text-gray-800 text-center w-full break-words mb-8 ${wordFontSizeClass}`}>{currentWord.word}</h2>
            {!showMeaning ? (
              <div className="absolute bottom-10 animate-bounce text-gray-300 flex flex-col items-center">
                <span className="text-sm">点击卡片看答案</span>
              </div>
            ) : (
              <div className="animate-in fade-in slide-in-from-bottom-4 w-full flex flex-col items-center">
                <div className="w-12 h-1 bg-pink-200 rounded-full mb-6"></div>
                <div className="flex flex-col w-full gap-3 text-left">
                  {(currentWord.definitions || []).map((def, idx) => (
                    <div key={idx} className="flex items-start text-left w-full">
                      {def.pos && <span className="inline-block bg-pink-100 text-pink-700 text-xs font-bold px-2 py-0.5 rounded-md mr-3 mt-0.5 shrink-0">{def.pos}</span>}
                      <span className="text-lg text-gray-700 font-medium break-words">{def.meaning}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="w-full flex gap-6 px-4">
          <button disabled={!showMeaning} onClick={() => handleFlashcardSwipe(false)} className={`flex-1 flex flex-col items-center justify-center py-4 rounded-3xl font-bold transition-all transform active:scale-90 ${showMeaning ? 'bg-rose-50 text-rose-500 hover:bg-rose-100 border-2 border-rose-200' : 'bg-gray-50 text-gray-300 opacity-50 cursor-not-allowed'}`}>
            <X size={32} className="mb-1" /><span className="text-sm">不认识</span>
          </button>
          <button disabled={!showMeaning} onClick={() => handleFlashcardSwipe(true)} className={`flex-1 flex flex-col items-center justify-center py-4 rounded-3xl font-bold transition-all transform active:scale-90 ${showMeaning ? 'bg-green-50 text-green-500 hover:bg-green-100 border-2 border-green-200' : 'bg-gray-50 text-gray-300 opacity-50 cursor-not-allowed'}`}>
            <Check size={32} className="mb-1" /><span className="text-sm">认识</span>
          </button>
        </div>
        {showMeaning && flowType !== 'review_book' && <p className="text-[10px] text-gray-400 mt-4 text-center">选"不认识"的词会自动加入生词本</p>}
      </div>
    );
  };

  const renderLearning = () => {
    const currentWord = wordList[currentWordIndex];
    if(!currentWord) return null;
    const recentWordsIndices = [];
    for (let i = Math.max(0, currentWordIndex - 5); i < currentWordIndex; i++) {
      if (!dismissedA4.includes(i) && !stickyWords.includes(i)) recentWordsIndices.push(i);
    }
    const wordLength = currentWord?.word?.length || 0;
    const wordFontSizeClass = wordLength > 30 ? 'text-2xl' : (wordLength > 15 ? 'text-3xl' : 'text-4xl');
    return (
      <div className="flex flex-col items-center w-full max-w-md mx-auto min-h-screen pb-10">
        <div className="w-full flex justify-between items-center mb-4 pt-4">
          <div className="flex gap-2 items-center">
            <button onClick={goHome} className="p-1.5 bg-gray-200 text-gray-600 rounded-full"><ArrowLeft size={16}/></button>
            <span className="text-sm font-medium text-gray-500 bg-gray-200 px-3 py-1 rounded-full">
              {isReviewing ? '错题复习' : flowType==='plan_daily' ? `Day ${activePlanDay} 任务` : '自由带背'}
            </span>
          </div>
          <span className="text-sm font-medium text-pink-600">{currentWordIndex + 1} / {wordList.length}</span>
        </div>
        <div className="w-full flex flex-col justify-center shrink-0">
          <div className={`w-full bg-white rounded-3xl shadow-lg border border-pink-100 p-6 flex flex-col items-center justify-center min-h-[220px] cursor-pointer transition-all duration-300 ${showMeaning ? 'bg-pink-50/30' : ''}`} onClick={() => setShowMeaning(true)}>
            <div className="flex flex-col items-center justify-center gap-4 mb-4 w-full">
              <h2 className={`font-extrabold text-gray-800 text-center w-full break-words ${wordFontSizeClass}`}>{currentWord?.word}</h2>
              <button onClick={(e) => { e.stopPropagation(); playAudio(currentWord?.word); }} className="p-3 text-pink-500 bg-pink-50 hover:bg-pink-100 rounded-full transition-colors active:scale-95"><Volume2 size={24} /></button>
            </div>
            {showMeaning ? (
              <div className="animate-in fade-in slide-in-from-bottom-2 w-full mt-4 flex flex-col items-center">
                <div className="w-10 h-1 bg-pink-200 rounded-full mb-6"></div>
                <div className="flex flex-col w-full gap-3 mb-4 px-2">
                  {(currentWord?.definitions || []).map((def, idx) => (
                    <div key={idx} className="flex items-start text-left w-full">
                      {def.pos && <span className="inline-block bg-pink-100 text-pink-700 text-xs font-bold px-2 py-0.5 rounded-md mr-3 mt-0.5 shrink-0 shadow-sm border border-pink-200/50">{def.pos}</span>}
                      <span className="text-lg text-gray-700 font-medium break-words leading-relaxed">{def.meaning}</span>
                    </div>
                  ))}
                </div>
                {currentWord?.explanation && (
                  <div className="bg-pink-50/80 p-4 rounded-xl w-full text-left mt-2">
                    <span className="text-xs font-bold text-pink-500 uppercase tracking-wider mb-2 block">💡 考点 / 解析</span>
                    <p className="text-sm text-gray-600 leading-snug">{currentWord?.explanation}</p>
                  </div>
                )}
              </div>
            ) : <div className="text-gray-400 flex flex-col items-center gap-2 mt-4"><BookOpen size={18} /><span className="text-sm">点击查看释义与笔记</span></div>}
          </div>
        </div>
        {stickyWords.length > 0 && (
          <div className="w-full mt-4 bg-rose-50 rounded-2xl shadow-sm border border-rose-100 p-4 animate-in fade-in">
            <div className="flex items-center gap-2 mb-3 text-rose-600"><Flame size={18} /><h3 className="text-sm font-bold">重点突破区</h3></div>
            <div className="space-y-3">
              {stickyWords.map(index => {
                const word = wordList[index];
                const isRevealed = revealedSticky.includes(index);
                return (
                  <div key={`sticky-${index}`} className="flex flex-col p-3 bg-white rounded-xl border border-rose-100 shadow-sm">
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-gray-800 flex-1 pr-2 break-words">{word.word}</span>
                      <button onClick={(e) => { e.stopPropagation(); playAudio(word.word); }} className="text-gray-400 hover:text-rose-500 pt-1"><Volume2 size={16} /></button>
                    </div>
                    {isRevealed ? (
                      <div className="mt-3 flex flex-col gap-2 bg-gray-50 p-3 rounded-lg animate-in fade-in">
                        {(word.definitions || []).map((def, dIdx) => (
                          <div key={dIdx} className="text-sm text-gray-700 flex items-start break-words">
                            {def.pos && <span className="font-bold text-pink-600 bg-pink-50 px-1 py-0.5 rounded mr-2 shrink-0 text-[10px]">{def.pos}</span>}
                            {def.meaning}
                          </div>
                        ))}
                      </div>
                    ) : <div className="mt-2 flex justify-end"><button onClick={() => toggleStickyWordReveal(index)} className="text-xs bg-white border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg">看释义</button></div>}
                    <div className="flex justify-end mt-3 pt-2 border-t border-rose-50"><button onClick={() => markAsRemembered(index)} className="text-xs flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-600 rounded-lg"><Check size={14} /> 移除</button></div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {recentWordsIndices.length > 0 && (
          <div className="w-full mt-4 bg-white rounded-2xl shadow-sm border border-pink-100 p-4 animate-in fade-in">
            <div className="flex items-center gap-2 mb-3 text-pink-600"><History size={18} /><h3 className="text-sm font-bold">A4 滚动复习</h3></div>
            <div className="space-y-3">
              {recentWordsIndices.map((actualIndex) => {
                const word = wordList[actualIndex];
                const isRevealed = revealedRecent.includes(actualIndex);
                return (
                  <div key={actualIndex} className="flex flex-col p-3 bg-pink-50/30 rounded-xl border border-pink-50/50">
                    <div className="flex items-start justify-between">
                      <span className="font-bold text-gray-700 flex-1 pr-2 break-words">{word.word}</span>
                      <button onClick={(e) => { e.stopPropagation(); playAudio(word.word); }} className="text-gray-400 hover:text-pink-500 pt-1"><Volume2 size={16} /></button>
                    </div>
                    {isRevealed ? (
                      <div className="mt-3 flex flex-col gap-2 bg-white/70 p-3 rounded-lg animate-in fade-in">
                        {(word.definitions || []).map((def, dIdx) => (
                          <div key={dIdx} className="text-sm text-gray-700 flex items-start break-words">
                            {def.pos && <span className="font-bold text-pink-600 bg-pink-50 px-1 py-0.5 rounded mr-2 shrink-0 text-[10px]">{def.pos}</span>}
                            {def.meaning}
                          </div>
                        ))}
                      </div>
                    ) : <div className="flex items-center justify-end gap-2 mt-2"><button onClick={() => toggleRecentWordReveal(actualIndex)} className="text-xs bg-white border border-gray-200 text-gray-500 px-3 py-1.5 rounded-lg">看释义</button><button onClick={() => markAsRemembered(actualIndex)} className="text-xs bg-green-50 text-green-600 px-3 py-1.5 rounded-lg flex items-center gap-1"><Check size={12}/>记住了</button></div>}
                    {isRevealed && <div className="flex justify-end gap-2 mt-3 pt-2 border-t border-pink-100/50 border-dashed"><button onClick={() => markAsSticky(actualIndex)} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-rose-50 text-rose-600 rounded-lg"><X size={14} />留着</button><button onClick={() => markAsRemembered(actualIndex)} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-green-50 text-green-600 rounded-lg"><Check size={14} />记住了</button></div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="w-full mt-6 pb-6">
          <button onClick={handleNextLearn} disabled={!showMeaning} className={`w-full flex items-center justify-center gap-2 p-4 rounded-2xl font-bold text-lg transition-all ${showMeaning ? 'bg-gradient-to-r from-pink-400 to-rose-500 text-white hover:from-pink-500 hover:to-rose-600 shadow-lg shadow-pink-200' : 'bg-gray-200 text-gray-400'}`}>
            {currentWordIndex < wordList.length - 1 ? '记牢了，下一个' : '复习完毕，开始测试'} <ArrowRight size={20} />
          </button>
        </div>
      </div>
    );
  };

  const renderTesting = () => {
    const currentWord = wordList[currentWordIndex];
    if(!currentWord) return null;
    const wordLength = currentWord?.word?.length || 0;
    const wordFontSizeClass = wordLength > 30 ? 'text-2xl' : (wordLength > 15 ? 'text-3xl' : 'text-4xl');
    return (
      <div className="flex flex-col items-center w-full max-w-md mx-auto py-10 h-full min-h-[70vh]">
        <div className="w-full flex justify-between items-center mb-6">
          <span className="text-sm font-medium text-pink-600 bg-pink-50 px-3 py-1 rounded-full border border-pink-200">🌸 检验成果阶段</span>
          <span className="text-sm font-medium text-pink-600">{currentWordIndex + 1} / {wordList.length}</span>
        </div>
        <div className="flex-1 w-full flex flex-col justify-center">
          <div className="w-full bg-white rounded-3xl shadow-xl border border-pink-100 p-8 flex flex-col items-center justify-center min-h-[300px]">
            <div className="flex flex-col items-center justify-center gap-4 mb-8 w-full">
              <h2 className={`font-extrabold text-gray-800 text-center w-full break-words ${wordFontSizeClass}`}>{currentWord?.word}</h2>
              <button onClick={() => playAudio(currentWord?.word)} className="p-3 text-pink-500 bg-pink-50 hover:bg-pink-100 rounded-full active:scale-95"><Volume2 size={28} /></button>
            </div>
            {!showMeaning ? (
              <button onClick={() => setShowMeaning(true)} className="px-6 py-3 bg-gray-100 hover:bg-pink-100 text-gray-700 hover:text-pink-700 rounded-xl font-medium w-full transition-colors">点我核对答案</button>
            ) : (
              <div className="animate-in fade-in duration-300 w-full flex flex-col items-center">
                <div className="flex flex-col w-full gap-3 mb-6 px-2 text-left">
                  {(currentWord?.definitions || []).map((def, idx) => (
                    <div key={idx} className="flex items-start w-full">
                      {def.pos && <span className="inline-block bg-pink-100 text-pink-700 text-xs font-bold px-2 py-0.5 rounded-md mr-3 mt-0.5 shrink-0 shadow-sm border border-pink-200/50">{def.pos}</span>}
                      <span className="text-lg text-gray-800 font-medium break-words leading-relaxed">{def.meaning}</span>
                    </div>
                  ))}
                </div>
                {currentWord?.explanation && <div className="bg-gray-50 p-4 rounded-xl w-full text-left mb-6 border border-gray-100"><span className="text-xs font-bold text-gray-400 mb-2 block">💡 考点回顾</span><p className="text-sm text-gray-600">{currentWord?.explanation}</p></div>}
                <p className="text-sm text-gray-500 mb-4">刚才你想得准确吗？(没想起的自动入生词本)</p>
                <div className="flex w-full gap-4">
                  <button onClick={() => handleTestResult(false)} className="flex-1 flex flex-col items-center justify-center gap-2 p-4 bg-rose-50 text-rose-600 rounded-2xl active:scale-95"><X size={24} /><span className="font-semibold">没想起来</span></button>
                  <button onClick={() => handleTestResult(true)} className="flex-1 flex flex-col items-center justify-center gap-2 p-4 bg-green-50 text-green-600 rounded-2xl active:scale-95"><Check size={24} /><span className="font-semibold">记住了！</span></button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderResults = () => {
    const accuracy = Math.round(((wordList.length - incorrectWords.length) / wordList.length) * 100);
    const isPerfect = incorrectWords.length === 0;
    return (
      <div className="flex flex-col items-center justify-center w-full max-w-md mx-auto py-10 space-y-8">
        <div className="text-center space-y-4">
          <div className={`inline-flex items-center justify-center w-24 h-24 rounded-full mb-4 ${isPerfect ? 'bg-pink-100 text-pink-500' : 'bg-rose-100 text-rose-500'}`}>
            {isPerfect ? <Sparkles size={48} /> : <Brain size={48} />}
          </div>
          <h2 className="text-3xl font-extrabold text-gray-800">{isPerfect ? '🌸 太棒了！全对！' : '🌸 测试完成！'}</h2>
          <p className="text-lg text-gray-500">本次正确率：<span className="font-bold text-pink-600">{accuracy}%</span></p>
        </div>
        {!isPerfect && (
          <div className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <h3 className="font-bold text-gray-800 text-lg flex items-center gap-2"><span className="w-2 h-6 bg-rose-400 rounded-full"></span>待攻克的条目 ({incorrectWords.length}个)</h3>
            <ul className="space-y-4 max-h-60 overflow-y-auto pr-2">
              {incorrectWords.map((word, idx) => (
                <li key={idx} className="flex flex-col border-b border-gray-50 pb-4 last:border-0 last:pb-0">
                  <span className="font-bold text-gray-800 break-words mb-2">{word.word}</span>
                  <div className="flex flex-col gap-1 text-sm text-gray-600">
                    {(word.definitions || []).map((def, dIdx) => (
                      <div key={dIdx} className="flex items-start">
                        {def.pos && <span className="font-bold text-pink-500 bg-pink-50 px-1 py-0.5 rounded text-[10px] mr-2 shrink-0">{def.pos}</span>}
                        <span>{def.meaning}</span>
                      </div>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-400 text-center pt-2">它们已自动加入您的生词本</p>
          </div>
        )}
        <div className="w-full space-y-3 pt-4">
          {!isPerfect && <button onClick={startReviewMistakes} className="w-full flex justify-center gap-2 bg-gradient-to-r from-pink-400 to-rose-500 text-white p-4 rounded-2xl font-bold shadow-lg shadow-pink-200"><RotateCcw size={20} />重新带我过一遍错题</button>}
          {flowType === 'plan_daily' ? (
            <button onClick={finishDailyPlan} className="w-full flex justify-center gap-2 bg-green-500 text-white p-4 rounded-2xl font-bold shadow-lg"><CheckCircle2 size={20} />打卡完成任务，回首页</button>
          ) : (
            <button onClick={goHome} className="w-full flex justify-center gap-2 bg-gray-100 text-gray-700 p-4 rounded-2xl font-bold"><BookOpen size={20} />返回首页</button>
          )}
        </div>
      </div>
    );
  };

  const renderSettingsModal = () => {
    if (!showSettings) return null;
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-3xl p-6 max-w-sm w-full shadow-2xl animate-in fade-in zoom-in-95">
          <h3 className="text-xl font-bold text-gray-800 mb-4">🌸 设置硅基流动 API Key</h3>
          <p className="text-sm text-gray-500 mb-2">
            请前往 <a href="https://cloud.siliconflow.cn" target="_blank" rel="noopener noreferrer" className="text-pink-600 underline">硅基流动平台</a> 注册并获取 API Key（免费）。
          </p>
          <input
            type="password"
            value={tempApiKey}
            onChange={(e) => setTempApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full p-3 border border-pink-300 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-pink-400"
          />
          <div className="flex gap-3">
            <button onClick={() => saveApiKey(tempApiKey)} className="flex-1 bg-gradient-to-r from-pink-400 to-rose-500 text-white p-3 rounded-xl font-bold hover:from-pink-500 hover:to-rose-600 transition">保存</button>
            <button onClick={() => { setShowSettings(false); setTempApiKey(''); }} className="flex-1 bg-gray-100 text-gray-700 p-3 rounded-xl font-bold hover:bg-gray-200 transition">取消</button>
          </div>
          <p className="text-xs text-gray-400 mt-3 text-center">密钥只保存在您的手机本地，不会上传到任何服务器</p>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-pink-50 via-white to-rose-50 font-sans text-gray-900 p-4 md:p-8 flex flex-col selection:bg-pink-200 selection:text-pink-900 overflow-y-auto">
      <div className="flex-1 w-full max-w-md mx-auto">
        {appState === 'home' && renderHome()}
        {appState === 'upload' && renderUpload()}
        {appState === 'analyzing' && renderAnalyzing()}
        {appState === 'confirming' && renderConfirming()}
        {appState === 'word_list' && renderWordList()}
        {appState === 'plan_setup' && renderPlanSetup()}
        {appState === 'learning' && renderLearning()}
        {appState === 'testing' && renderTesting()}
        {appState === 'results' && renderResults()}
        {appState === 'flashcard' && renderFlashcardMode()}
      </div>
      {renderSettingsModal()}
    </div>
  );
}
