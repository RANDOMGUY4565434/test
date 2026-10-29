const socket = io();
const elements = {
  onlineCount: document.querySelector('#online-count'),
  ageConfirmation: document.querySelector('#age-confirmation'),
  startButton: document.querySelector('#start-button'),
  nextButton: document.querySelector('#next-button'),
  stopButton: document.querySelector('#stop-button'),
  reportButton: document.querySelector('#report-button'),
  messageForm: document.querySelector('#message-form'),
  messageInput: document.querySelector('#message-input'),
  sendButton: document.querySelector('#send-button'),
  messageList: document.querySelector('#message-list'),
  emptyState: document.querySelector('#empty-state'),
  chatTitle: document.querySelector('#chat-title'),
  chatSubtitle: document.querySelector('#chat-subtitle'),
  connectionStatus: document.querySelector('#connection-status'),
  typingIndicator: document.querySelector('#typing-indicator'),
  interestInput: document.querySelector('#interest-input'),
  interestList: document.querySelector('#interest-list'),
  toast: document.querySelector('#toast'),
  safetyDialog: document.querySelector('#safety-dialog'),
  reportDialog: document.querySelector('#report-dialog'),
  reportReason: document.querySelector('#report-reason'),
};

const topics = new Set();
let inChat = false;
let waiting = false;
let typingTimer;
let toastTimer;

function updateIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove('visible'), 3200);
}

function setStatus(title, subtitle, status) {
  elements.chatTitle.textContent = title;
  elements.chatSubtitle.textContent = subtitle;
  elements.connectionStatus.textContent = status;
}

function setChatControls(enabled) {
  inChat = enabled;
  elements.messageInput.disabled = !enabled;
  elements.sendButton.disabled = !enabled;
  elements.stopButton.disabled = !enabled && !waiting;
  elements.nextButton.disabled = !enabled;
  elements.reportButton.disabled = !enabled;
  if (enabled) elements.messageInput.placeholder = 'Write a message...';
  else elements.messageInput.placeholder = 'Find someone to say hello to';
}

function clearMessages() {
  elements.messageList.replaceChildren();
  elements.emptyState.hidden = true;
}

function addSystemMessage(text) {
  const message = document.createElement('div');
  message.className = 'system-message';
  message.textContent = text;
  elements.messageList.append(message);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function addMessage(text, mine, sentAt = Date.now()) {
  const row = document.createElement('div');
  row.className = `message-row${mine ? ' mine' : ''}`;
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.append(document.createTextNode(text));
  const timestamp = document.createElement('span');
  timestamp.className = 'message-time';
  timestamp.textContent = new Date(sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  bubble.append(timestamp);
  row.append(bubble);
  elements.messageList.append(row);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderTopics() {
  elements.interestList.replaceChildren();
  for (const topic of topics) {
    const chip = document.createElement('span');
    chip.className = 'interest-chip';
    chip.append(document.createTextNode(topic));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '×';
    remove.title = `Remove ${topic}`;
    remove.setAttribute('aria-label', `Remove ${topic}`);
    remove.addEventListener('click', () => {
      topics.delete(topic);
      renderTopics();
    });
    chip.append(remove);
    elements.interestList.append(chip);
  }
}

function addTopic(rawTopic) {
  const topic = rawTopic.trim().slice(0, 24);
  if (!topic || topics.size >= 6 || [...topics].some((item) => item.toLowerCase() === topic.toLowerCase())) return;
  topics.add(topic);
  renderTopics();
}

function startFinding(eventName = 'start') {
  if (!elements.ageConfirmation.checked) {
    showToast('Please confirm that you are 18 or older.');
    return;
  }
  waiting = true;
  setChatControls(false);
  elements.stopButton.disabled = false;
  elements.startButton.disabled = true;
  elements.startButton.querySelector('span').textContent = 'Looking for someone';
  setStatus('Finding your person...', 'This usually takes just a moment', 'Searching');
  socket.emit(eventName, { adultConfirmed: true, topics: [...topics] });
}

elements.ageConfirmation.addEventListener('change', () => {
  elements.startButton.disabled = !elements.ageConfirmation.checked || waiting || inChat;
});

elements.startButton.addEventListener('click', () => startFinding());
elements.stopButton.addEventListener('click', () => {
  socket.emit('stop');
  waiting = false;
  setChatControls(false);
  elements.startButton.disabled = !elements.ageConfirmation.checked;
  elements.startButton.querySelector('span').textContent = 'Find someone';
  setStatus('Your next conversation', 'A stranger is just a hello away', 'Not connected');
  elements.typingIndicator.textContent = '';
  addSystemMessage('You left the chat.');
});

elements.nextButton.addEventListener('click', () => {
  waiting = true;
  clearMessages();
  setChatControls(false);
  elements.stopButton.disabled = false;
  elements.startButton.disabled = true;
  elements.startButton.querySelector('span').textContent = 'Looking for someone';
  setStatus('Finding your next person...', 'Looking for a fresh conversation', 'Searching');
  socket.emit('next');
});

elements.messageForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const message = elements.messageInput.value.trim();
  if (!message || !inChat) return;
  socket.emit('message', message);
  elements.messageInput.value = '';
  socket.emit('typing', false);
});

elements.messageInput.addEventListener('input', () => {
  if (!inChat) return;
  socket.emit('typing', true);
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => socket.emit('typing', false), 900);
});

function submitInterest() {
  addTopic(elements.interestInput.value);
  elements.interestInput.value = '';
}

document.querySelector('#add-interest').addEventListener('click', submitInterest);
elements.interestInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    submitInterest();
  }
});

document.querySelectorAll('.suggestion').forEach((button) => {
  button.addEventListener('click', () => addTopic(button.dataset.topic));
});

elements.reportButton.addEventListener('click', () => elements.reportDialog.showModal());
document.querySelector('#cancel-report').addEventListener('click', () => elements.reportDialog.close());
document.querySelector('#submit-report').addEventListener('click', () => {
  socket.emit('report', elements.reportReason.value);
  elements.reportDialog.close();
});

document.querySelector('#safety-button').addEventListener('click', () => elements.safetyDialog.showModal());
document.querySelector('#guidelines-button').addEventListener('click', () => elements.safetyDialog.showModal());
document.querySelector('.dialog-done').addEventListener('click', () => elements.safetyDialog.close());

socket.on('connect', () => {
  elements.onlineCount.textContent = 'Online';
  elements.connectionStatus.textContent = 'Connected';
});

socket.on('disconnect', () => {
  waiting = false;
  setChatControls(false);
  elements.startButton.disabled = !elements.ageConfirmation.checked;
  elements.startButton.querySelector('span').textContent = 'Find someone';
  setStatus('Connection lost', 'Check your connection and try again', 'Disconnected');
  showToast('Your connection was interrupted.');
});

socket.on('online-count', (count) => {
  elements.onlineCount.textContent = `${count} ${count === 1 ? 'person' : 'people'} online`;
});

socket.on('queue-status', () => {
  waiting = true;
  setChatControls(false);
  elements.stopButton.disabled = false;
  setStatus('Looking for someone...', 'Your topics help us find common ground', 'Searching');
});

socket.on('matched', ({ sharedTopics }) => {
  waiting = false;
  clearMessages();
  setChatControls(true);
  elements.startButton.disabled = true;
  elements.startButton.querySelector('span').textContent = 'You are chatting';
  elements.messageInput.focus();
  const commonGround = sharedTopics.length ? `You both like ${sharedTopics.join(', ')}` : 'Say hello and see where it goes';
  setStatus('You’re chatting with a stranger', commonGround, 'Connected');
  addSystemMessage('You’re connected. Keep it kind, and keep it anonymous.');
});

socket.on('message', ({ text, sentAt }) => addMessage(text, false, sentAt));
socket.on('message-sent', ({ text, sentAt }) => addMessage(text, true, sentAt));

socket.on('partner-typing', (isTyping) => {
  elements.typingIndicator.textContent = isTyping ? 'Stranger is typing...' : '';
});

socket.on('partner-left', () => {
  waiting = false;
  setChatControls(false);
  elements.startButton.disabled = !elements.ageConfirmation.checked;
  elements.startButton.querySelector('span').textContent = 'Find someone';
  elements.typingIndicator.textContent = '';
  setStatus('They left the chat', 'A new conversation is one click away', 'Chat ended');
  addSystemMessage('The stranger left the chat.');
});

socket.on('chat-stopped', () => {
  waiting = false;
  setChatControls(false);
});

socket.on('report-accepted', () => {
  waiting = false;
  setChatControls(false);
  elements.startButton.disabled = !elements.ageConfirmation.checked;
  elements.startButton.querySelector('span').textContent = 'Find someone';
  setStatus('Report received', 'That person is blocked for this session', 'Chat ended');
  addSystemMessage('Report sent. This person is blocked for this session.');
  showToast('Thanks for helping keep sideby safer.');
});

socket.on('app-error', (message) => showToast(message));

if (!window.lucide) {
  const iconScript = document.createElement('script');
  iconScript.src = 'https://unpkg.com/lucide@latest';
  iconScript.onload = updateIcons;
  document.head.append(iconScript);
} else {
  updateIcons();
}