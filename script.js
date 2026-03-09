// Ambient Canvas Particle System
const canvas = document.getElementById('ambient-canvas');
const ctx = canvas.getContext('2d');

let width, height;
let particles = [];
const particleCount = 60; // Adjust for performance

function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

class Particle {
    constructor() {
        this.reset();
    }

    reset() {
        this.x = Math.random() * width;
        this.y = Math.random() * height;
        this.vx = (Math.random() - 0.5) * 0.3; // Very slow movement
        this.vy = (Math.random() - 0.5) * 0.3;
        this.radius = Math.random() * 2 + 0.5;
        this.alpha = Math.random() * 0.5 + 0.1;
        // Mix of cyan and purple dots
        this.color = Math.random() > 0.5 ? '124, 58, 237' : '192, 132, 252';
    }

    update() {
        this.x += this.vx;
        this.y += this.vy;

        // Wrap around
        if (this.x < 0) this.x = width;
        if (this.x > width) this.x = 0;
        if (this.y < 0) this.y = height;
        if (this.y > height) this.y = 0;
    }

    draw() {
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${this.color}, ${this.alpha})`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = `rgb(${this.color})`;
        ctx.fill();
    }
}

function initParticles() {
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }
}

function animateParticles() {
    ctx.clearRect(0, 0, width, height);

    // Draw lines between close particles
    for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
            const dx = particles[i].x - particles[j].x;
            const dy = particles[i].y - particles[j].y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < 120) {
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(particles[j].x, particles[j].y);
                const alpha = 1 - (distance / 120);
                const color = particles[i].color;
                ctx.strokeStyle = `rgba(${color}, ${alpha * 0.2})`;
                ctx.lineWidth = 0.5;
                ctx.stroke();
            }
        }
    }

    particles.forEach(p => {
        p.update();
        p.draw();
    });

    requestAnimationFrame(animateParticles);
}

initParticles();
animateParticles();

// Terminal Typewriter Effect
const terminalBody = document.getElementById('typewriter');
const commands = [
    { text: "Initializing Ephemeral Swarm Controller...", delay: 800 },
    { text: "Connecting to distributed node mesh... [OK]", delay: 1200 },
    { text: "Authenticating secure identity... [OK]", delay: 800 },
    { text: "Deploying Agent #8904A-X...", delay: 1500 },
    { text: "Task: Distributed Retrieval. Status: Running...", delay: 2000 },
    { text: "Task complete. Output integrated.", delay: 800 },
    { text: "Agent #8904A-X terminated. Zero footprint remaining.", delay: 1000 },
    { text: "Log written to persistent memory.", delay: 800 },
    { text: "Awaiting next instruction...", delay: 5000 }
];

let commandIndex = 0;

function createLineElement() {
    const line = document.createElement('div');
    line.className = 'terminal-line';

    const prompt = document.createElement('span');
    prompt.className = 'prompt';
    prompt.innerText = '❯';

    const textSpan = document.createElement('span');
    textSpan.className = 'text';

    line.appendChild(prompt);
    line.appendChild(textSpan);

    return { line, textSpan };
}

async function typeCommand(cmd) {
    const { line, textSpan } = createLineElement();

    // add cursor
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    line.appendChild(cursor);

    terminalBody.appendChild(line);

    for (let i = 0; i < cmd.text.length; i++) {
        textSpan.innerHTML += cmd.text.charAt(i);
        await new Promise(r => setTimeout(r, 20 + Math.random() * 40));
    }

    cursor.remove(); // Remove cursor from finished line
    await new Promise(r => setTimeout(r, cmd.delay));
}

async function runTerminal() {
    terminalBody.innerHTML = '';

    for (const cmd of commands) {
        await typeCommand(cmd);
    }

    // Add blinking cursor at the end
    const { line } = createLineElement();
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    line.appendChild(cursor);
    terminalBody.appendChild(line);

    // Loop
    setTimeout(runTerminal, 3000);
}

// Start terminal when in view
const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
        runTerminal();
        observer.disconnect();
    }
}, { threshold: 0.5 });

observer.observe(document.getElementById('terminal'));

// Smooth Scrolling for Anchors
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth'
            });
        }
    });
});
