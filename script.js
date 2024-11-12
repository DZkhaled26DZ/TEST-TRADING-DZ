const API_KEY = 'nc3cvP0d3LZzL9AIIgQQsjU6MKN8g5oanFkiAo4BdykbaOlce3HsTbWB3mPCoL8z';
const BINANCE_API = 'https://api.binance.com/api/v3';

let chart;
let currentPair = 'BTCUSDT';
let currentInterval = '15m';
let lastSignalUpdate = 0;
let signalUpdateInterval = 15 * 60 * 1000; // 15 minutes in milliseconds
let currentSignals = new Map();
let chartUpdateInterval = 1000; // Default 1 second
let updateTimer;
let volatilityHistory = new Map();

// Initialize the application
async function init() {
    setupEventListeners();
    await loadCryptoPairs();
    startRealTimeUpdates();
    createChart();
}

// Set up event listeners
function setupEventListeners() {
    document.getElementById('cryptoSelect').addEventListener('change', (e) => {
        currentPair = e.target.value.replace('/', '');
        updateUI();
    });

    document.getElementById('intervalSelect').addEventListener('change', (e) => {
        currentInterval = e.target.value;
        document.getElementById('updateInterval').textContent = getMinutesFromInterval(currentInterval);
        signalUpdateInterval = getMinutesFromInterval(currentInterval) * 60 * 1000;
        updateUI();
    });

    document.getElementById('customInterval').addEventListener('change', (e) => {
        const minutes = parseInt(e.target.value);
        if (minutes && minutes > 0) {
            currentInterval = `${minutes}m`;
            signalUpdateInterval = minutes * 60 * 1000;
            document.getElementById('updateInterval').textContent = minutes;
            updateUI();
        }
    });

    document.getElementById('chartUpdateInterval').addEventListener('change', (e) => {
        chartUpdateInterval = parseInt(e.target.value);
        restartRealTimeUpdates();
    });

    document.getElementById('searchInput').addEventListener('input', (e) => {
        filterCryptoPairs(e.target.value);
    });
}

function restartRealTimeUpdates() {
    if (updateTimer) {
        clearInterval(updateTimer);
    }
    startRealTimeUpdates();
}

function getMinutesFromInterval(interval) {
    const unit = interval.slice(-1);
    const value = parseInt(interval);
    switch(unit) {
        case 'm': return value;
        case 'h': return value * 60;
        case 'd': return value * 24 * 60;
        case 'w': return value * 7 * 24 * 60;
        case 'M': return value * 30 * 24 * 60;
        default: return 15;
    }
}

// Load available crypto pairs
async function loadCryptoPairs() {
    try {
        const response = await fetch(`${BINANCE_API}/exchangeInfo`);
        const data = await response.json();
        const select = document.getElementById('cryptoSelect');
        
        const pairs = data.symbols
            .filter(symbol => symbol.quoteAsset === 'USDT')
            .map(symbol => ({
                symbol: symbol.symbol,
                baseAsset: symbol.baseAsset
            }));

        pairs.forEach(pair => {
            const option = document.createElement('option');
            option.value = `${pair.baseAsset}/USDT`;
            option.textContent = `${pair.baseAsset}/USDT`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading crypto pairs:', error);
    }
}

// Create price chart
function createChart() {
    const ctx = document.getElementById('priceChart').getContext('2d');
    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: [{
                label: 'السعر',
                data: [],
                borderColor: '#007bff',
                tension: 0.4,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false
                }
            },
            plugins: {
                legend: {
                    display: false
                }
            }
        }
    });
}

// Start real-time price updates
function startRealTimeUpdates() {
    updateTimer = setInterval(async () => {
        await updatePrice();
        
        // Update signals based on interval
        const now = Date.now();
        if (now - lastSignalUpdate >= signalUpdateInterval) {
            await updateSignals();
            lastSignalUpdate = now;
        }
    }, chartUpdateInterval);
}

// Calculate volatility
function calculateVolatility(prices) {
    if (prices.length < 2) return 0;
    
    const returns = [];
    for (let i = 1; i < prices.length; i++) {
        returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
    
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    return Math.sqrt(variance);
}

// Update current price
async function updatePrice() {
    try {
        const response = await fetch(`${BINANCE_API}/ticker/price?symbol=${currentPair}`);
        const data = await response.json();
        
        const price = parseFloat(data.price).toFixed(8);
        document.getElementById('currentPrice').textContent = price;
        
        // Update trend icon
        const prevPrice = chart.data.datasets[0].data[chart.data.datasets[0].data.length - 1];
        const trendIcon = document.getElementById('trendIcon');
        if (price > prevPrice) {
            trendIcon.innerHTML = '<i class="fas fa-arrow-up"></i>';
            trendIcon.className = 'trend-icon price-up';
        } else if (price < prevPrice) {
            trendIcon.innerHTML = '<i class="fas fa-arrow-down"></i>';
            trendIcon.className = 'trend-icon price-down';
        } else {
            trendIcon.innerHTML = '<i class="fas fa-minus"></i>';
            trendIcon.className = 'trend-icon neutral';
        }
        
        // Update chart
        if (chart.data.labels.length > 50) {
            chart.data.labels.shift();
            chart.data.datasets[0].data.shift();
        }
        
        chart.data.labels.push(new Date().toLocaleTimeString());
        chart.data.datasets[0].data.push(price);
        chart.update();

        // Update volatility
        const prices = chart.data.datasets[0].data;
        const volatility = calculateVolatility(prices);
        const isHighVolatility = volatility > 0.002; // 0.2% threshold
        
        document.getElementById('volatilityWarning').classList.toggle('hidden', !isHighVolatility);
        volatilityHistory.set(currentPair, isHighVolatility);
        
    } catch (error) {
        console.error('Error updating price:', error);
    }
}

// Calculate trading signals using StochRSI
async function calculateSignals() {
    try {
        const response = await fetch(`${BINANCE_API}/klines?symbol=${currentPair}&interval=${currentInterval}&limit=100`);
        const data = await response.json();
        
        const closes = data.map(candle => parseFloat(candle[4]));
        const stochRSI = calculateStochRSI(closes);
        
        const currentPrice = parseFloat(closes[closes.length - 1]);
        const signal = generateSignal(stochRSI, currentPrice);
        
        return signal;
    } catch (error) {
        console.error('Error calculating signals:', error);
        return null;
    }
}

// Calculate StochRSI indicator
function calculateStochRSI(prices, period = 14) {
    const gains = [];
    const losses = [];
    
    for (let i = 1; i < prices.length; i++) {
        const difference = prices[i] - prices[i - 1];
        gains.push(difference > 0 ? difference : 0);
        losses.push(difference < 0 ? Math.abs(difference) : 0);
    }
    
    const avgGain = gains.slice(-period).reduce((a, b) => a + b) / period;
    const avgLoss = losses.slice(-period).reduce((a, b) => a + b) / period;
    
    const rs = avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    
    return rsi;
}

// Generate trading signal
function generateSignal(stochRSI, currentPrice) {
    const volatility = 0.01; // 1% volatility factor
    const stopLoss = currentPrice * (1 - volatility);
    const targets = [
        currentPrice * (1 + volatility),
        currentPrice * (1 + volatility * 2),
        currentPrice * (1 + volatility * 3)
    ];
    
    const trend = stochRSI < 30 ? 'شراء' : stochRSI > 70 ? 'بيع' : 'انتظار';
    const trendIcon = trend === 'شراء' ? '<i class="fas fa-arrow-trend-up"></i>' : 
                     trend === 'بيع' ? '<i class="fas fa-arrow-trend-down"></i>' : 
                     '<i class="fas fa-clock"></i>';
    
    return {
        type: trend,
        icon: trendIcon,
        price: currentPrice.toFixed(8),
        stopLoss: stopLoss.toFixed(8),
        targets: targets.map(t => t.toFixed(8)),
        timestamp: Date.now(),
        interval: currentInterval,
        isHighVolatility: volatilityHistory.get(currentPair) || false
    };
}

// Update trading signals
async function updateSignals() {
    const signal = await calculateSignals();
    if (!signal) return;
    
    const signalsList = document.getElementById('signalsList');
    const signalCard = document.createElement('div');
    signalCard.className = 'signal-card';
    
    const expiryTime = new Date(signal.timestamp + signalUpdateInterval);
    const statusClass = signal.type === 'شراء' ? 'status-buy' : 
                       signal.type === 'بيع' ? 'status-sell' : 
                       'status-wait';
    
    signalCard.innerHTML = `
        <h4>
            ${currentPair} - ${signal.type}
            <span class="signal-trend">${signal.icon}</span>
        </h4>
        <span class="signal-status ${statusClass}">
            ${signal.type === 'شراء' ? 'موصى بالشراء' : 
              signal.type === 'بيع' ? 'موصى بالبيع' : 
              'انتظار'}
        </span>
        <p>السعر الحالي: ${signal.price}</p>
        <p>وقف الخسارة: ${signal.stopLoss}</p>
        <p>الأهداف:</p>
        <ul>
            ${signal.targets.map((target, i) => `<li>الهدف ${i + 1}: ${target}</li>`).join('')}
        </ul>
        <p class="signal-expiry">صالحة حتى: ${expiryTime.toLocaleTimeString()}</p>
        ${signal.isHighVolatility ? `
            <div class="signal-warning">
                <i class="fas fa-exclamation-triangle"></i>
                تحذير: تقلبات عالية في السعر، يرجى توخي الحذر
            </div>
        ` : ''}
    `;
    
    // Keep only the latest 10 signals
    while (signalsList.children.length >= 10) {
        signalsList.removeChild(signalsList.firstChild);
    }
    
    signalsList.insertBefore(signalCard, signalsList.firstChild);
    currentSignals.set(currentPair, signal);
}

// Filter crypto pairs based on search input
function filterCryptoPairs(searchTerm) {
    const select = document.getElementById('cryptoSelect');
    const options = select.getElementsByTagName('option');
    
    for (let option of options) {
        const value = option.value.toLowerCase();
        if (value.includes(searchTerm.toLowerCase())) {
            option.style.display = '';
        } else {
            option.style.display = 'none';
        }
    }
}

// Update UI elements
async function updateUI() {
    document.getElementById('currentPair').textContent = currentPair;
    await updatePrice();
    await updateSignals();
}

// Initialize the application
document.addEventListener('DOMContentLoaded', init);