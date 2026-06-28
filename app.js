"use strict";

const DEFAULT_EXAM_SIZE = 24;
const MAX_VISUAL_QUESTIONS = 2;
const RARE_OCCURRENCE_LIMIT = 3;
const SCORE_CORRECT = 0.5;
const SCORE_INCORRECT = -0.25;

const state = {
  allQuestions: [],
  questionsById: new Map(),
  occurrenceCounts: new Map(),
  hasOccurrenceReport: false,
  examQuestions: [],
  answers: [],
  visited: [],
  currentIndex: 0,
};

const elements = {
  setupScreen: document.querySelector("#setup-screen"),
  quizScreen: document.querySelector("#quiz-screen"),
  resultsScreen: document.querySelector("#results-screen"),
  setupMessage: document.querySelector("#setup-message"),
  startButton: document.querySelector("#start-button"),
  partAStatus: document.querySelector("#part-a-status"),
  partBStatus: document.querySelector("#part-b-status"),
  bothStatus: document.querySelector("#both-status"),
  partBOption: document.querySelector("#part-b-option"),
  bothOption: document.querySelector("#both-option"),
  rareStatus: document.querySelector("#rare-status"),
  rareOption: document.querySelector("#rare-option"),
  yearSelect: document.querySelector("#year-select"),
  questionCount: document.querySelector("#question-count"),
  questionCountStatus: document.querySelector("#question-count-status"),
  questionIndex: document.querySelector("#question-index"),
  questionHeading: document.querySelector("#question-heading"),
  questionMetadata: document.querySelector("#question-metadata"),
  contextArea: document.querySelector("#context-area"),
  questionContent: document.querySelector("#question-content"),
  answerButtons: [...document.querySelectorAll("[data-answer]")],
  previousButton: document.querySelector("#previous-button"),
  nextButton: document.querySelector("#next-button"),
  submitButton: document.querySelector("#submit-button"),
  scoreText: document.querySelector("#score-text"),
  resultCounts: document.querySelector("#result-counts"),
  reviewList: document.querySelector("#review-list"),
  newExamButton: document.querySelector("#new-exam-button"),
};

function formulaFallback(text) {
  return /[=∈≤≥≈≠→←∞∑∏√±]/u.test(text);
}

function isVisualQuestion(question) {
  return Boolean(
    question.has_visual_content
    || question.has_formula
    || formulaFallback(question.question)
    || question.images?.length
    || question.context_question_ids?.length
  );
}

function duplicateKey(text) {
  return text.toLocaleLowerCase().replace(/\s+/g, " ").trim().replace(/[ .]+$/g, "");
}

function uniqueQuestionKey(question) {
  return duplicateKey(question.question || question.id || "");
}

function occurrenceKey(section, text) {
  return `${section}:${duplicateKey(text)}`;
}

function questionOccurrenceCount(question) {
  return question.occurrence_count ?? null;
}

function isRareQuestion(question) {
  const count = questionOccurrenceCount(question);
  return Number.isInteger(count) && count <= RARE_OCCURRENCE_LIMIT;
}

function uniqueQuestions(questions, existingKeys = new Set()) {
  const seen = new Set(existingKeys);
  return questions.filter((question) => {
    const key = uniqueQuestionKey(question);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicatePlainQuestions(questions) {
  const referencedIds = new Set(questions.flatMap((question) => question.context_question_ids || []));
  const seenPlain = new Set();

  return questions.filter((question) => {
    if (isVisualQuestion(question) || referencedIds.has(question.id)) return true;
    const key = `${questionYear(question)}:${duplicateKey(question.question)}`;
    if (seenPlain.has(key)) return false;
    seenPlain.add(key);
    return true;
  });
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}

function showScreen(screen) {
  for (const candidate of [elements.setupScreen, elements.quizScreen, elements.resultsScreen]) {
    candidate.hidden = candidate !== screen;
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function createImage(path, alt, className) {
  const image = document.createElement("img");
  image.src = path;
  image.alt = alt;
  image.className = className;
  image.loading = "lazy";
  return image;
}

function appendQuestionDisplay(container, question, includeContext = true) {
  if (includeContext) {
    for (const referenceId of question.context_question_ids || []) {
      const reference = state.questionsById.get(referenceId);
      if (!reference?.question_crop) continue;
      const contextBox = document.createElement("div");
      contextBox.className = "context-box";
      const label = document.createElement("p");
      label.textContent = "Figure/context referenced by this question:";
      contextBox.append(label, createImage(reference.question_crop, reference.question, "context-image"));
      container.append(contextBox);
    }
  }

  if (isVisualQuestion(question) && question.question_crop) {
    container.append(createImage(question.question_crop, question.question, "question-image"));
    return;
  }

  const text = document.createElement("p");
  text.className = "question-text";
  text.textContent = question.question;
  container.append(text);

  if (!question.question_crop) {
    for (const imagePath of question.images || []) {
      container.append(createImage(imagePath, `Visual for: ${question.question}`, "question-image"));
    }
  }
}

function selectedSection() {
  return document.querySelector('input[name="section"]:checked')?.value || "A";
}

function rareQuestionPool(year = "ALL") {
  const rareQuestions = state.allQuestions.filter((question) => isRareQuestion(question) && !isVisualQuestion(question));
  const yearFiltered = year === "ALL"
    ? rareQuestions
    : rareQuestions.filter((question) => questionYear(question) === year);
  return uniqueQuestions(yearFiltered);
}

function sectionPool(section) {
  if (section === "RARE") return rareQuestionPool();
  if (section === "AB") return state.allQuestions.filter((question) => ["A", "B"].includes(question.section));
  return state.allQuestions.filter((question) => question.section === section);
}

function questionYear(question) {
  return question.source_pdf?.match(/(?:19|20)\d{2}/)?.[0] || "Unknown";
}

function selectedYear() {
  return elements.yearSelect.value || "ALL";
}

function filteredPool(section = selectedSection(), year = selectedYear()) {
  if (section === "RARE") return rareQuestionPool(year);
  const pool = sectionPool(section);
  return year === "ALL" ? pool : pool.filter((question) => questionYear(question) === year);
}

function availablePool(section = selectedSection(), year = selectedYear()) {
  return uniqueQuestions(filteredPool(section, year));
}

function populateYearOptions() {
  const previousYear = selectedYear();
  const years = [...new Set(sectionPool(selectedSection()).map(questionYear))]
    .filter((year) => year !== "Unknown")
    .sort((a, b) => Number(b) - Number(a));

  elements.yearSelect.replaceChildren();
  const allYears = new Option("All available years", "ALL");
  elements.yearSelect.append(allYears);
  for (const year of years) elements.yearSelect.append(new Option(year, year));
  elements.yearSelect.value = years.includes(previousYear) ? previousYear : "ALL";
}

function updateQuestionCount() {
  const available = availablePool().length;
  const current = Number.parseInt(elements.questionCount.value, 10);
  elements.questionCount.max = String(Math.max(1, available));
  elements.questionCount.disabled = available === 0;
  elements.questionCount.value = String(
    Number.isInteger(current) && current >= 1
      ? Math.min(current, available)
      : Math.min(DEFAULT_EXAM_SIZE, available)
  );
  elements.questionCountStatus.textContent = `${available} questions available for this selection`;
  elements.startButton.disabled = available === 0;
}

function updateSetupFilters() {
  populateYearOptions();
  elements.yearSelect.disabled = false;
  updateQuestionCount();
}

function selectExamQuestions(pool, requestedSize) {
  const uniquePool = uniqueQuestions(pool);
  const allVisualQuestions = shuffle(uniquePool.filter(isVisualQuestion));
  const plainQuestions = shuffle(uniquePool.filter((question) => !isVisualQuestion(question)));
  const targetSize = Math.min(requestedSize, uniquePool.length);
  const visualQuestions = allVisualQuestions.slice(0, Math.min(MAX_VISUAL_QUESTIONS, targetSize));
  const selected = [
    ...visualQuestions,
    ...plainQuestions.slice(0, Math.max(0, targetSize - visualQuestions.length)),
  ];
  if (selected.length < targetSize) {
    selected.push(...allVisualQuestions.slice(visualQuestions.length, visualQuestions.length + targetSize - selected.length));
  }
  return shuffle(selected);
}

function splitBothQuestionCount(requestedSize, partACount, partBCount) {
  let partATarget = Math.min(Math.ceil(requestedSize / 2), partACount);
  let partBTarget = Math.min(requestedSize - partATarget, partBCount);
  let remaining = requestedSize - partATarget - partBTarget;

  if (remaining > 0) {
    const extraA = Math.min(remaining, partACount - partATarget);
    partATarget += extraA;
    remaining -= extraA;
  }

  if (remaining > 0) {
    const extraB = Math.min(remaining, partBCount - partBTarget);
    partBTarget += extraB;
  }

  return { partATarget, partBTarget };
}

function selectBothExamQuestions(requestedSize) {
  const year = selectedYear();
  const partAPool = availablePool("A", year);
  const partBPool = availablePool("B", year);
  const { partATarget } = splitBothQuestionCount(
    requestedSize,
    partAPool.length,
    partBPool.length
  );

  let partAQuestions = selectExamQuestions(partAPool, partATarget);
  const usedPartAKeys = new Set(partAQuestions.map(uniqueQuestionKey));
  let partBPoolWithoutA = uniqueQuestions(partBPool, usedPartAKeys);
  let partBQuestions = selectExamQuestions(partBPoolWithoutA, requestedSize - partAQuestions.length);

  let usedKeys = new Set([...partAQuestions, ...partBQuestions].map(uniqueQuestionKey));
  if (partAQuestions.length + partBQuestions.length < requestedSize) {
    const extraPartAQuestions = selectExamQuestions(
      uniqueQuestions(partAPool, usedKeys),
      requestedSize - partAQuestions.length - partBQuestions.length
    );
    partAQuestions = [...partAQuestions, ...extraPartAQuestions];
  }

  usedKeys = new Set([...partAQuestions, ...partBQuestions].map(uniqueQuestionKey));
  if (partAQuestions.length + partBQuestions.length < requestedSize) {
    partBPoolWithoutA = uniqueQuestions(partBPool, usedKeys);
    const extraPartBQuestions = selectExamQuestions(
      partBPoolWithoutA,
      requestedSize - partAQuestions.length - partBQuestions.length
    );
    partBQuestions = [...partBQuestions, ...extraPartBQuestions];
  }

  return [...partAQuestions, ...partBQuestions];
}

function startExam() {
  const pool = availablePool();
  if (!pool.length) {
    elements.setupMessage.textContent = "No questions are available for that selection.";
    return;
  }

  const requestedSize = Number.parseInt(elements.questionCount.value, 10);
  if (!Number.isInteger(requestedSize) || requestedSize < 1 || requestedSize > pool.length) {
    elements.setupMessage.textContent = `Choose between 1 and ${pool.length} questions.`;
    return;
  }

  state.examQuestions = selectedSection() === "AB"
    ? selectBothExamQuestions(requestedSize)
    : selectExamQuestions(pool, requestedSize);
  state.answers = Array(state.examQuestions.length).fill(undefined);
  state.visited = Array(state.examQuestions.length).fill(false);
  state.currentIndex = 0;
  elements.setupMessage.textContent = "";
  showScreen(elements.quizScreen);
  renderQuestion();
}

function renderQuestion() {
  const question = state.examQuestions[state.currentIndex];
  const total = state.examQuestions.length;

  const year = questionYear(question);
  elements.questionHeading.textContent = `Question ${state.currentIndex + 1} of ${total}`;
  const occurrenceCount = questionOccurrenceCount(question);
  const occurrenceLabel = Number.isInteger(occurrenceCount)
    ? ` · Seen ${occurrenceCount} time${occurrenceCount === 1 ? "" : "s"}`
    : "";
  elements.questionMetadata.textContent = `Original exam: ${year} · Part ${question.section} · Question ${question.number ?? "unknown"}${occurrenceLabel}`;
  elements.contextArea.replaceChildren();
  elements.questionContent.replaceChildren();

  for (const referenceId of question.context_question_ids || []) {
    const reference = state.questionsById.get(referenceId);
    if (!reference?.question_crop) continue;
    const contextBox = document.createElement("div");
    contextBox.className = "context-box";
    const label = document.createElement("p");
    label.textContent = "Figure/context referenced by this question:";
    contextBox.append(label, createImage(reference.question_crop, reference.question, "context-image"));
    elements.contextArea.append(contextBox);
  }
  appendQuestionDisplay(elements.questionContent, question, false);
  renderQuestionIndex();

  const currentAnswer = state.answers[state.currentIndex];
  for (const button of elements.answerButtons) {
    const value = button.dataset.answer;
    const selected = (value === "blank" && currentAnswer === null)
      || (value === "true" && currentAnswer === true)
      || (value === "false" && currentAnswer === false);
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }

  elements.previousButton.disabled = state.currentIndex === 0;
  elements.nextButton.disabled = state.currentIndex === total - 1;
}

function changeQuestion(offset) {
  const nextIndex = state.currentIndex + offset;
  if (nextIndex < 0 || nextIndex >= state.examQuestions.length) return;
  goToQuestion(nextIndex);
}

function restoreViewport(scrollX, scrollY) {
  window.scrollTo({ left: scrollX, top: scrollY, behavior: "auto" });
  requestAnimationFrame(() => {
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "auto" });
  });
}

function goToQuestion(nextIndex, options = {}) {
  const { scrollToTop = true } = options;
  if (nextIndex === state.currentIndex) return;
  state.visited[state.currentIndex] = true;
  state.currentIndex = nextIndex;
  renderQuestion();
  if (scrollToTop) {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function answerCurrentQuestion(value) {
  const previousScrollX = window.scrollX;
  const previousScrollY = window.scrollY;
  state.answers[state.currentIndex] = value === "blank" ? null : value === "true";
  state.visited[state.currentIndex] = true;
  if (state.currentIndex < state.examQuestions.length - 1) {
    goToQuestion(state.currentIndex + 1, { scrollToTop: false });
  } else {
    renderQuestion();
  }
  restoreViewport(previousScrollX, previousScrollY);
}

function renderQuestionIndex() {
  elements.questionIndex.replaceChildren();

  state.examQuestions.forEach((question, index) => {
    const button = document.createElement("button");
    const answer = state.answers[index];
    const isAnswered = typeof answer === "boolean";
    const isBlank = state.visited[index] && !isAnswered;
    const status = isAnswered ? "answered" : isBlank ? "left blank" : "not visited";

    button.type = "button";
    button.textContent = String(index + 1);
    button.classList.toggle("answered", isAnswered);
    button.classList.toggle("blank", isBlank);
    button.classList.toggle("current", index === state.currentIndex);
    button.setAttribute("aria-label", `Question ${index + 1}: ${status}${index === state.currentIndex ? ", current question" : ""}`);
    button.addEventListener("click", () => goToQuestion(index));
    elements.questionIndex.append(button);
  });
}

function answerLabel(answer) {
  if (answer == null) return "No answer";
  return answer ? "True" : "False";
}

function addCount(label, value) {
  const item = document.createElement("span");
  item.textContent = `${label}: ${value}`;
  elements.resultCounts.append(item);
}

function submitExam() {
  let correct = 0;
  let incorrect = 0;
  let unanswered = 0;

  state.examQuestions.forEach((question, index) => {
    const answer = state.answers[index];
    if (answer == null) unanswered += 1;
    else if (answer === question.answer) correct += 1;
    else incorrect += 1;
  });

  const score = correct * SCORE_CORRECT + incorrect * SCORE_INCORRECT;
  elements.scoreText.textContent = `Score: ${score.toFixed(2)} points`;
  elements.resultCounts.replaceChildren();
  addCount("Correct", correct);
  addCount("Incorrect", incorrect);
  addCount("Unanswered", unanswered);
  renderReview();
  showScreen(elements.resultsScreen);
}

function renderReview() {
  elements.reviewList.replaceChildren();

  state.examQuestions.forEach((question, index) => {
    const givenAnswer = state.answers[index];
    const status = givenAnswer == null ? "unanswered" : givenAnswer === question.answer ? "correct" : "incorrect";
    const item = document.createElement("article");
    item.className = `review-item ${status}`;

    const header = document.createElement("div");
    header.className = "review-header";
    const heading = document.createElement("h4");
    heading.textContent = `Question ${index + 1} — ${status[0].toUpperCase()}${status.slice(1)}`;
    const infoButton = document.createElement("button");
    const sourceId = `question-source-${index}`;
    infoButton.type = "button";
    infoButton.className = "question-info-button";
    infoButton.textContent = "i";
    infoButton.setAttribute("aria-label", `Show source information for question ${index + 1}`);
    infoButton.setAttribute("aria-controls", sourceId);
    infoButton.setAttribute("aria-expanded", "false");
    header.append(heading, infoButton);
    item.append(header);

    const sourceInfo = document.createElement("div");
    sourceInfo.id = sourceId;
    sourceInfo.className = "question-source";
    sourceInfo.hidden = true;
    const occurrenceCount = questionOccurrenceCount(question);
    const occurrenceLabel = Number.isInteger(occurrenceCount)
      ? ` · Seen ${occurrenceCount} time${occurrenceCount === 1 ? "" : "s"} in the source exams`
      : "";
    sourceInfo.textContent = `Original question ${question.number ?? "unknown"} · Source PDF: ${question.source_pdf || "unknown"}${occurrenceLabel}`;
    infoButton.addEventListener("click", () => {
      const willOpen = sourceInfo.hidden;
      sourceInfo.hidden = !willOpen;
      infoButton.setAttribute("aria-expanded", String(willOpen));
    });
    item.append(sourceInfo);

    appendQuestionDisplay(item, question);

    const answerSummary = document.createElement("div");
    answerSummary.className = `answer-summary ${status}`;
    const givenLabel = document.createElement("span");
    givenLabel.className = "answer-summary-label";
    givenLabel.textContent = "Your answer";
    const givenValue = document.createElement("strong");
    givenValue.textContent = answerLabel(givenAnswer);
    answerSummary.append(givenLabel, givenValue);

    if (status !== "correct") {
      const correction = document.createElement("span");
      correction.className = "answer-correction";
      correction.textContent = `Correct answer: ${answerLabel(question.answer)}`;
      answerSummary.append(correction);
    }
    item.append(answerSummary);

    if (question.explanation) {
      const explanation = document.createElement("p");
      explanation.className = "explanation";
      explanation.textContent = `Explanation: ${question.explanation}`;
      item.append(explanation);
    }
    elements.reviewList.append(item);
  });
}

async function loadOccurrenceCounts() {
  try {
    const response = await fetch("question_occurrences.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new Error("question_occurrences.json is not a list");

    state.occurrenceCounts = new Map(
      rows.map((row) => [
        occurrenceKey(row.part, row.question),
        Number.parseInt(row.occurrences, 10),
      ])
    );
    state.hasOccurrenceReport = state.occurrenceCounts.size > 0;
  } catch (error) {
    state.occurrenceCounts = new Map();
    state.hasOccurrenceReport = false;
    console.warn("Could not load question_occurrences.json", error);
  }
}

function applyOccurrenceCounts(questions) {
  return questions.map((question) => ({
    ...question,
    occurrence_count: state.occurrenceCounts.get(occurrenceKey(question.section, question.question)) ?? null,
  }));
}

function updateRareOptionStatus() {
  if (!state.hasOccurrenceReport) {
    elements.rareOption.disabled = true;
    elements.rareOption.closest("label").classList.add("unavailable");
    elements.rareStatus.textContent = "Run the occurrence report first";
    return;
  }

  const rareCount = sectionPool("RARE").length;
  elements.rareOption.disabled = rareCount === 0;
  elements.rareOption.closest("label").classList.toggle("unavailable", rareCount === 0);
  elements.rareStatus.textContent = rareCount > 0
    ? `${rareCount} questions seen ${RARE_OCCURRENCE_LIMIT} times or less`
    : "No rare questions found";
}

async function loadQuestions() {
  try {
    await loadOccurrenceCounts();
    const response = await fetch("questions.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const loaded = await response.json();
    const loadedQuestions = Array.isArray(loaded)
      ? loaded
      : Object.values(loaded.parts || {}).flat();
    if (!loadedQuestions.length) throw new Error("questions.json contains no questions");

    const questions = applyOccurrenceCounts(loadedQuestions);
    state.allQuestions = deduplicatePlainQuestions(questions);
    state.questionsById = new Map(state.allQuestions.map((question) => [question.id, question]));
    const partACount = sectionPool("A").length;
    const partBCount = sectionPool("B").length;
    elements.partAStatus.textContent = `${partACount} available questions`;

    if (partBCount > 0) {
      elements.partBOption.disabled = false;
      elements.bothOption.disabled = false;
      elements.partBOption.closest("label").classList.remove("unavailable");
      elements.bothOption.closest("label").classList.remove("unavailable");
      elements.partBStatus.textContent = `${partBCount} available questions`;
      elements.bothStatus.textContent = `${partACount + partBCount} available questions`;
    }
    updateRareOptionStatus();

    updateSetupFilters();
  } catch (error) {
    elements.setupMessage.textContent = "Could not load questions.json. Start the local web server described in README.md, then open the HTTP address.";
    elements.partAStatus.textContent = "Questions unavailable";
    console.error(error);
  }
}

elements.startButton.addEventListener("click", startExam);
document.querySelectorAll('input[name="section"]').forEach((option) => {
  option.addEventListener("change", updateSetupFilters);
});
elements.yearSelect.addEventListener("change", updateQuestionCount);
elements.questionCount.addEventListener("input", () => {
  elements.setupMessage.textContent = "";
});
elements.previousButton.addEventListener("click", () => changeQuestion(-1));
elements.nextButton.addEventListener("click", () => changeQuestion(1));
elements.submitButton.addEventListener("click", submitExam);
elements.newExamButton.addEventListener("click", () => showScreen(elements.setupScreen));
elements.answerButtons.forEach((button) => {
  button.addEventListener("click", () => answerCurrentQuestion(button.dataset.answer));
});

loadQuestions();
