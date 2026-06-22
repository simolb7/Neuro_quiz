"use strict";

const EXAM_SIZE = 24;
const SCORE_CORRECT = 0.5;
const SCORE_INCORRECT = -0.25;

const state = {
  allQuestions: [],
  questionsById: new Map(),
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
  questionIndex: document.querySelector("#question-index"),
  questionHeading: document.querySelector("#question-heading"),
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

function deduplicatePlainQuestions(questions) {
  const referencedIds = new Set(questions.flatMap((question) => question.context_question_ids || []));
  const seenPlain = new Set();

  return questions.filter((question) => {
    if (isVisualQuestion(question) || referencedIds.has(question.id)) return true;
    const key = duplicateKey(question.question);
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

function sectionPool(section) {
  if (section === "AB") return state.allQuestions.filter((question) => ["A", "B"].includes(question.section));
  return state.allQuestions.filter((question) => question.section === section);
}

function startExam() {
  const pool = sectionPool(selectedSection());
  if (!pool.length) {
    elements.setupMessage.textContent = "No questions are available for that selection.";
    return;
  }

  state.examQuestions = shuffle(pool).slice(0, Math.min(EXAM_SIZE, pool.length));
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

  elements.questionHeading.textContent = `Question ${state.currentIndex + 1}`;
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

function goToQuestion(nextIndex) {
  if (nextIndex === state.currentIndex) return;
  state.visited[state.currentIndex] = true;
  state.currentIndex = nextIndex;
  renderQuestion();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function answerCurrentQuestion(value) {
  state.answers[state.currentIndex] = value === "blank" ? null : value === "true";
  state.visited[state.currentIndex] = true;
  if (state.currentIndex < state.examQuestions.length - 1) {
    goToQuestion(state.currentIndex + 1);
  } else {
    renderQuestion();
  }
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
    sourceInfo.textContent = `Original question ${question.number ?? "unknown"} · Source PDF: ${question.source_pdf || "unknown"}`;
    infoButton.addEventListener("click", () => {
      const willOpen = sourceInfo.hidden;
      sourceInfo.hidden = !willOpen;
      infoButton.setAttribute("aria-expanded", String(willOpen));
    });
    item.append(sourceInfo);

    appendQuestionDisplay(item, question);

    const answers = document.createElement("div");
    answers.className = "review-answers";

    const givenAnswerCard = document.createElement("div");
    givenAnswerCard.className = `answer-memory-card your-answer ${status}`;
    const givenLabel = document.createElement("span");
    givenLabel.className = "answer-memory-label";
    givenLabel.textContent = "Your answer";
    const givenValue = document.createElement("strong");
    givenValue.textContent = answerLabel(givenAnswer);
    givenAnswerCard.append(givenLabel, givenValue);

    const correctAnswerCard = document.createElement("div");
    correctAnswerCard.className = "answer-memory-card correct-answer";
    const correctLabel = document.createElement("span");
    correctLabel.className = "answer-memory-label";
    correctLabel.textContent = "Correct answer";
    const correctValue = document.createElement("strong");
    correctValue.textContent = answerLabel(question.answer);
    correctAnswerCard.append(correctLabel, correctValue);

    answers.append(givenAnswerCard, correctAnswerCard);
    item.append(answers);

    if (question.explanation) {
      const explanation = document.createElement("p");
      explanation.className = "explanation";
      explanation.textContent = `Explanation: ${question.explanation}`;
      item.append(explanation);
    }
    elements.reviewList.append(item);
  });
}

async function loadQuestions() {
  try {
    const response = await fetch("questions.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const loaded = await response.json();
    if (!Array.isArray(loaded)) throw new Error("questions.json is not an array");

    state.allQuestions = deduplicatePlainQuestions(loaded);
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

    elements.startButton.disabled = partACount === 0;
  } catch (error) {
    elements.setupMessage.textContent = "Could not load questions.json. Start the local web server described in README.md, then open the HTTP address.";
    elements.partAStatus.textContent = "Questions unavailable";
    console.error(error);
  }
}

elements.startButton.addEventListener("click", startExam);
elements.previousButton.addEventListener("click", () => changeQuestion(-1));
elements.nextButton.addEventListener("click", () => changeQuestion(1));
elements.submitButton.addEventListener("click", submitExam);
elements.newExamButton.addEventListener("click", () => showScreen(elements.setupScreen));
elements.answerButtons.forEach((button) => {
  button.addEventListener("click", () => answerCurrentQuestion(button.dataset.answer));
});

loadQuestions();
