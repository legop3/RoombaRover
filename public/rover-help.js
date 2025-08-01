// Enhanced Rover Help System with Stable Force-Directed Layout
let helpMode = false;
let helpElements = [];
const helpButton = document.getElementById('helpButton');
const helpOverlay = document.getElementById('helpOverlay');
const helpContainer = document.getElementById('helpContainer') || createHelpContainer();

// Physics simulation parameters
const PHYSICS_CONFIG = {
    repulsionForce: 1500,      // How strongly boxes repel each other
    attractionForce: 0.1,      // How strongly boxes are attracted to their targets
    damping: 0.7,              // Velocity damping (0-1, higher = less bouncy)
    minDistance: 10,           // Minimum distance between box edges
    maxIterations: 150,        // Maximum physics simulation steps
    convergenceThreshold: 1.0, // Stop when movement is small enough
    timeStep: 0.5,             // Physics time step (smaller = more stable)
    maxVelocity: 3             // Cap velocity to prevent erratic movement
};

// Create help container if it doesn't exist
function createHelpContainer() {
    const container = document.createElement('div');
    container.id = 'helpContainer';
    container.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10000;
        display: none;
    `;
    document.body.appendChild(container);
    return container;
}

// Toggle help mode on/off
function toggleHelpMode() {
    helpMode = !helpMode;
    
    if (helpMode) {
        helpButton.classList.add('active');
        helpButton.textContent = 'Exit';
        helpButton.title = 'Exit Help Mode';
        helpOverlay.classList.add('show');
        document.body.style.cursor = 'help';
        showAllHelpMessages();
    } else {
        helpButton.classList.remove('active');
        helpButton.textContent = 'Help';
        helpButton.title = 'Toggle Help Mode';
        helpOverlay.classList.remove('show');
        document.body.style.cursor = 'default';
        hideAllHelpMessages();
    }
}

// Show all help messages with force-directed layout
function showAllHelpMessages() {
    helpContainer.style.display = 'block';
    helpContainer.innerHTML = '';
    helpElements = [];
    
    const elementsWithHelp = document.querySelectorAll('[data-help]');
    
    elementsWithHelp.forEach((element, index) => {
        const helpText = element.getAttribute('data-help');
        if (!helpText) return;
        
        element.classList.add('help-highlight');
        
        const helpBox = createHelpBox(helpText, index);
        helpContainer.appendChild(helpBox);
        
        // Initialize physics properties
        const physics = {
            x: 0, y: 0,           // Current position (center of box)
            vx: 0, vy: 0,         // Velocity
            targetX: 0, targetY: 0, // Target position near element
            width: 0, height: 0,   // Box dimensions
            isSettled: false       // Whether this box has stopped moving
        };
        
        helpElements.push({ 
            element, 
            helpBox, 
            physics,
            index
        });
    });
    
    // Initial positioning and physics setup
    initializePositions();
    
    // Run physics simulation
    runPhysicsSimulation();
}

// Create individual help message box
function createHelpBox(text, index) {
    const helpBox = document.createElement('div');
    helpBox.className = 'help-message-box';
    helpBox.style.cssText = `
        position: absolute;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 1px 1px;
        border-radius: 8px;
        font-size: 14px;
        max-width: 250px;
        word-wrap: break-word;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        pointer-events: auto;
        z-index: 10001;
        border: 1px solid #444;
        visibility: hidden;
    `;
    helpBox.textContent = text;
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '';
    // closeBtn.style.cssText = `
    //     position: absolute;
    //     top: 4px;
    //     right: 8px;
    //     background: none;
    //     border: none;
    //     color: white;
    //     cursor: pointer;
    //     font-size: 16px;
    //     padding: 0;
    //     width: 16px;
    //     height: 16px;
    //     display: block;
    //     align-items: center;
    //     justify-content: center;
    // `;
    closeBtn.onclick = () => hideIndividualHelp(index);
    helpBox.appendChild(closeBtn);
    
    return helpBox;
}

// Initialize positions for physics simulation
function initializePositions() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    helpElements.forEach(({ element, helpBox, physics }) => {
        const rect = element.getBoundingClientRect();
        const helpRect = helpBox.getBoundingClientRect();
        
        // Store dimensions
        physics.width = helpRect.width;
        physics.height = helpRect.height;
        
        // Calculate preferred position near the target element
        const elementCenter = {
            x: rect.left + scrollLeft + rect.width / 2,
            y: rect.top + scrollTop + rect.height / 2
        };
        
        // Try positions around the element (prefer above/below)
        const positions = [
            { x: elementCenter.x, y: elementCenter.y - rect.height / 2 - physics.height / 2 - 30 }, // Above
            { x: elementCenter.x, y: elementCenter.y + rect.height / 2 + physics.height / 2 + 30 }, // Below  
            { x: elementCenter.x + rect.width / 2 + physics.width / 2 + 30, y: elementCenter.y }, // Right
            { x: elementCenter.x - rect.width / 2 - physics.width / 2 - 30, y: elementCenter.y } // Left
        ];
        
        // Find the best position that's on screen
        let bestPos = positions[0];
        for (const pos of positions) {
            if (isPositionOnScreen(pos, physics)) {
                bestPos = pos;
                break;
            }
        }
        
        // Set target position (center of where the box wants to be)
        physics.targetX = bestPos.x;
        physics.targetY = bestPos.y;
        
        // Start at target position with small random offset to break symmetry
        physics.x = physics.targetX + (Math.random() - 0.5) * 100;
        physics.y = physics.targetY + (Math.random() - 0.5) * 100;
        
        // Ensure starting position is on screen
        const bounds = getScreenBounds();
        physics.x = Math.max(bounds.left + physics.width/2, Math.min(bounds.right - physics.width/2, physics.x));
        physics.y = Math.max(bounds.top + physics.height/2, Math.min(bounds.bottom - physics.height/2, physics.y));
        
        // Set initial DOM position (convert from center to top-left)
        updateBoxPosition(helpBox, physics);
        helpBox.style.visibility = 'visible';
    });
}

// Get screen bounds with margins
function getScreenBounds() {
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const margin = 15;
    
    return {
        left: margin,
        right: window.innerWidth - margin,
        top: scrollTop + margin,
        bottom: scrollTop + window.innerHeight - margin
    };
}

// Check if position is on screen
function isPositionOnScreen(pos, physics) {
    const bounds = getScreenBounds();
    
    return pos.x - physics.width / 2 >= bounds.left &&
           pos.x + physics.width / 2 <= bounds.right &&
           pos.y - physics.height / 2 >= bounds.top &&
           pos.y + physics.height / 2 <= bounds.bottom;
}

// Update box DOM position from physics center coordinates
function updateBoxPosition(helpBox, physics) {
    const left = physics.x - physics.width / 2;
    const top = physics.y - physics.height / 2;
    
    helpBox.style.left = left + 'px';
    helpBox.style.top = top + 'px';
}

// Check if box overlaps with its target element
function boxOverlapsTarget(helpElement) {
    const physics = helpElement.physics;
    const targetRect = helpElement.element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    // Convert target to same coordinate system (center-based)
    const targetCenter = {
        x: targetRect.left + scrollLeft + targetRect.width / 2,
        y: targetRect.top + scrollTop + targetRect.height / 2
    };
    
    const dx = Math.abs(physics.x - targetCenter.x);
    const dy = Math.abs(physics.y - targetCenter.y);
    
    const minDistanceX = physics.width / 2 + targetRect.width / 2 + 20;
    const minDistanceY = physics.height / 2 + targetRect.height / 2 + 20;
    
    return dx < minDistanceX && dy < minDistanceY;
}

// Check if two boxes overlap (with proper distance calculation)
function boxesOverlap(physics1, physics2) {
    const dx = Math.abs(physics1.x - physics2.x);
    const dy = Math.abs(physics1.y - physics2.y);
    
    const minDistanceX = (physics1.width + physics2.width) / 2 + PHYSICS_CONFIG.minDistance;
    const minDistanceY = (physics1.height + physics2.height) / 2 + PHYSICS_CONFIG.minDistance;
    
    return dx < minDistanceX && dy < minDistanceY;
}

// Run physics simulation to position boxes
function runPhysicsSimulation() {
    let iteration = 0;
    
    function simulationStep() {
        let totalMovement = 0;
        let activeBoxes = 0;
        
        // Calculate forces for each box
        helpElements.forEach((helpElement, i) => {
            if (!helpElement || helpElement.physics.isSettled) return;
            
            const { physics } = helpElement;
            let forceX = 0;
            let forceY = 0;
            
            // Attraction force toward target position
            const attractionDx = physics.targetX - physics.x;
            const attractionDy = physics.targetY - physics.y;
            const attractionDistance = Math.sqrt(attractionDx * attractionDx + attractionDy * attractionDy);
            
            if (attractionDistance > 5) {
                forceX += (attractionDx / attractionDistance) * PHYSICS_CONFIG.attractionForce * attractionDistance;
                forceY += (attractionDy / attractionDistance) * PHYSICS_CONFIG.attractionForce * attractionDistance;
            }
            
            // Repulsion forces from target element
            const targetRect = helpElement.element.getBoundingClientRect();
            const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
            const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
            
            const targetCenter = {
                x: targetRect.left + scrollLeft + targetRect.width / 2,
                y: targetRect.top + scrollTop + targetRect.height / 2
            };
            
            const repulsionDx = physics.x - targetCenter.x;
            const repulsionDy = physics.y - targetCenter.y;
            const repulsionDistance = Math.sqrt(repulsionDx * repulsionDx + repulsionDy * repulsionDy);
            
            // Calculate minimum distance from target element
            const targetMinDistanceX = physics.width / 2 + targetRect.width / 2 + 25;
            const targetMinDistanceY = physics.height / 2 + targetRect.height / 2 + 25;
            const targetMinDistance = Math.sqrt(targetMinDistanceX * targetMinDistanceX + targetMinDistanceY * targetMinDistanceY);
            
            if (repulsionDistance < targetMinDistance && repulsionDistance > 0) {
                const targetRepulsionStrength = PHYSICS_CONFIG.repulsionForce * 1.5 * (targetMinDistance - repulsionDistance) / (repulsionDistance * repulsionDistance);
                forceX += (repulsionDx / repulsionDistance) * targetRepulsionStrength;
                forceY += (repulsionDy / repulsionDistance) * targetRepulsionStrength;
            }
            
            // Repulsion forces from other boxes
            helpElements.forEach((otherElement, j) => {
                if (i === j || !otherElement) return;
                
                const other = otherElement.physics;
                const dx = physics.x - other.x;
                const dy = physics.y - other.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                if (distance < 1) return; // Avoid division by zero
                
                // Calculate minimum required distance
                const minDistanceX = (physics.width + other.width) / 2 + PHYSICS_CONFIG.minDistance;
                const minDistanceY = (physics.height + other.height) / 2 + PHYSICS_CONFIG.minDistance;
                const minDistance = Math.sqrt(minDistanceX * minDistanceX + minDistanceY * minDistanceY);
                
                if (distance < minDistance) {
                    const repulsionStrength = PHYSICS_CONFIG.repulsionForce * (minDistance - distance) / (distance * distance);
                    forceX += (dx / distance) * repulsionStrength;
                    forceY += (dy / distance) * repulsionStrength;
                }
            });
            
            // Update velocity with damping
            physics.vx = physics.vx * PHYSICS_CONFIG.damping + forceX * PHYSICS_CONFIG.timeStep;
            physics.vy = physics.vy * PHYSICS_CONFIG.damping + forceY * PHYSICS_CONFIG.timeStep;
            
            // Cap velocity to prevent erratic movement
            const velocity = Math.sqrt(physics.vx * physics.vx + physics.vy * physics.vy);
            if (velocity > PHYSICS_CONFIG.maxVelocity) {
                physics.vx = (physics.vx / velocity) * PHYSICS_CONFIG.maxVelocity;
                physics.vy = (physics.vy / velocity) * PHYSICS_CONFIG.maxVelocity;
            }
            
            // Update position
            const newX = physics.x + physics.vx;
            const newY = physics.y + physics.vy;
            
            // Keep within screen bounds
            const bounds = getScreenBounds();
            physics.x = Math.max(bounds.left + physics.width/2, Math.min(bounds.right - physics.width/2, newX));
            physics.y = Math.max(bounds.top + physics.height/2, Math.min(bounds.bottom - physics.height/2, newY));
            
            // If box hit boundary, reduce velocity
            if (physics.x !== newX) physics.vx *= 0.3;
            if (physics.y !== newY) physics.vy *= 0.3;
            
            // Track movement for convergence
            const movement = Math.abs(physics.vx) + Math.abs(physics.vy);
            totalMovement += movement;
            
            // Mark as settled if moving very slowly
            if (movement < 0.1) {
                physics.isSettled = true;
            } else {
                activeBoxes++;
            }
            
            // Update DOM element position
            updateBoxPosition(helpElement.helpBox, physics);
        });
        
        iteration++;
        
        // Continue simulation if boxes are still moving and under iteration limit
        if (activeBoxes > 0 && 
            totalMovement > PHYSICS_CONFIG.convergenceThreshold && 
            iteration < PHYSICS_CONFIG.maxIterations) {
            requestAnimationFrame(simulationStep);
        } else {
            console.log(`Physics simulation completed in ${iteration} iterations`);
            
            // Final overlap check and correction
            performFinalOverlapCorrection();
            
            // Create arrows
            setTimeout(createAllArrows, 100);
        }
    }
    
    // Start simulation
    requestAnimationFrame(simulationStep);
}

// Final pass to ensure no overlaps remain
function performFinalOverlapCorrection() {
    for (let attempt = 0; attempt < 10; attempt++) {
        let foundOverlap = false;
        
        // Check box-to-box overlaps
        for (let i = 0; i < helpElements.length; i++) {
            if (!helpElements[i]) continue;
            
            for (let j = i + 1; j < helpElements.length; j++) {
                if (!helpElements[j]) continue;
                
                const physics1 = helpElements[i].physics;
                const physics2 = helpElements[j].physics;
                
                if (boxesOverlap(physics1, physics2)) {
                    foundOverlap = true;
                    separateBoxes(helpElements[i], helpElements[j]);
                }
            }
        }
        
        // Check box-to-target overlaps
        for (let i = 0; i < helpElements.length; i++) {
            if (!helpElements[i]) continue;
            
            if (boxOverlapsTarget(helpElements[i])) {
                foundOverlap = true;
                separateBoxFromTarget(helpElements[i]);
            }
        }
        
        if (!foundOverlap) break;
    }
}

// Separate two overlapping boxes
function separateBoxes(helpElement1, helpElement2) {
    const physics1 = helpElement1.physics;
    const physics2 = helpElement2.physics;
    
    const dx = physics1.x - physics2.x;
    const dy = physics1.y - physics2.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    
    const minDistanceX = (physics1.width + physics2.width) / 2 + PHYSICS_CONFIG.minDistance;
    const minDistanceY = (physics1.height + physics2.height) / 2 + PHYSICS_CONFIG.minDistance;
    const minDistance = Math.sqrt(minDistanceX * minDistanceX + minDistanceY * minDistanceY);
    
    const separationNeeded = minDistance - distance + 5;
    const moveDistance = separationNeeded / 2;
    
    const moveX = (dx / distance) * moveDistance;
    const moveY = (dy / distance) * moveDistance;
    
    // Move boxes apart
    const bounds = getScreenBounds();
    
    physics1.x = Math.max(bounds.left + physics1.width/2, 
                 Math.min(bounds.right - physics1.width/2, physics1.x + moveX));
    physics1.y = Math.max(bounds.top + physics1.height/2, 
                 Math.min(bounds.bottom - physics1.height/2, physics1.y + moveY));
    
    physics2.x = Math.max(bounds.left + physics2.width/2, 
                 Math.min(bounds.right - physics2.width/2, physics2.x - moveX));
    physics2.y = Math.max(bounds.top + physics2.height/2, 
                 Math.min(bounds.bottom - physics2.height/2, physics2.y - moveY));
    
    // Update DOM positions
    updateBoxPosition(helpElement1.helpBox, physics1);
    updateBoxPosition(helpElement2.helpBox, physics2);
}

// Separate box from its target element
function separateBoxFromTarget(helpElement) {
    const physics = helpElement.physics;
    const targetRect = helpElement.element.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    const targetCenter = {
        x: targetRect.left + scrollLeft + targetRect.width / 2,
        y: targetRect.top + scrollTop + targetRect.height / 2
    };
    
    const dx = physics.x - targetCenter.x;
    const dy = physics.y - targetCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy) || 1;
    
    const minDistanceX = physics.width / 2 + targetRect.width / 2 + 25;
    const minDistanceY = physics.height / 2 + targetRect.height / 2 + 25;
    const minDistance = Math.sqrt(minDistanceX * minDistanceX + minDistanceY * minDistanceY);
    
    const separationNeeded = minDistance - distance + 10;
    
    const moveX = (dx / distance) * separationNeeded;
    const moveY = (dy / distance) * separationNeeded;
    
    // Move box away from target
    const bounds = getScreenBounds();
    
    physics.x = Math.max(bounds.left + physics.width/2, 
                Math.min(bounds.right - physics.width/2, physics.x + moveX));
    physics.y = Math.max(bounds.top + physics.height/2, 
                Math.min(bounds.bottom - physics.height/2, physics.y + moveY));
    
    // Update DOM position
    updateBoxPosition(helpElement.helpBox, physics);
}

// Create arrows after simulation is complete
function createAllArrows() {
    helpElements.forEach(({ element, helpBox, physics }) => {
        if (element && helpBox) {
            createExtendedArrow(helpBox, element);
        }
    });
}

// Create extended arrow that can stretch to reach the target element
function createExtendedArrow(helpBox, targetElement) {
    helpBox.querySelectorAll('.help-arrow, .help-arrow-line').forEach(el => el.remove());
    
    const targetRect = targetElement.getBoundingClientRect();
    const helpRect = helpBox.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
    
    const targetCenter = {
        x: targetRect.left + scrollLeft + (targetRect.width / 2),
        y: targetRect.top + scrollTop + (targetRect.height / 2)
    };
    
    const helpCenter = {
        x: helpRect.left + scrollLeft + (helpRect.width / 2),
        y: helpRect.top + scrollTop + (helpRect.height / 2)
    };
    
    const deltaX = targetCenter.x - helpCenter.x;
    const deltaY = targetCenter.y - helpCenter.y;
    const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
    const angle = Math.atan2(deltaY, deltaX);
    
    createArrowLine(helpBox, angle, distance);
}

// Create extended arrow line that reaches to the target
function createArrowLine(helpBox, angle, distance) {
    const helpRect = helpBox.getBoundingClientRect();
    
    const arrowLine = document.createElement('div');
    arrowLine.className = 'help-arrow-line';
    
    // Calculate start point on help box edge
    const helpRadius = Math.min(helpRect.width, helpRect.height) / 2;
    const startX = helpRadius * Math.cos(angle);
    const startY = helpRadius * Math.sin(angle);
    
    const lineLength = Math.max(0, distance - helpRadius - 25);
    
    const lineStyles = {
        position: 'absolute',
        width: lineLength + 'px',
        height: '2px',
        background: 'rgba(255, 255, 255, 0.8)',
        transformOrigin: '0 50%',
        transform: `translate(${startX}px, ${startY}px) rotate(${angle}rad)`,
        left: '50%',
        top: '50%',
        zIndex: 10001,
        pointerEvents: 'none',
        boxShadow: '0 0 2px rgba(0, 0, 0, 0.5)'
    };
    
    Object.assign(arrowLine.style, lineStyles);
    helpBox.appendChild(arrowLine);
    
    // Create arrowhead
    const arrowHead = document.createElement('div');
    arrowHead.className = 'help-arrow-head';
    
    const arrowSize = 6;
    const arrowHeadStyles = {
        position: 'absolute',
        width: 0,
        height: 0,
        right: '-' + arrowSize + 'px',
        top: '50%',
        transform: 'translateY(-50%)',
        borderTop: arrowSize + 'px solid transparent',
        borderBottom: arrowSize + 'px solid transparent',
        borderLeft: arrowSize + 'px solid rgba(255, 255, 255, 0.8)',
        zIndex: 10002,
        filter: 'drop-shadow(0 0 1px rgba(0, 0, 0, 0.5))'
    };
    
    Object.assign(arrowHead.style, arrowHeadStyles);
    arrowLine.appendChild(arrowHead);
}

// Hide individual help message
function hideIndividualHelp(index) {
    const helpElement = helpElements.find(he => he && he.index === index);
    if (helpElement) {
        helpElement.element.classList.remove('help-highlight');
        helpElement.helpBox.remove();
        const elementIndex = helpElements.indexOf(helpElement);
        helpElements[elementIndex] = null;
    }
}

// Hide all help messages
function hideAllHelpMessages() {
    helpContainer.style.display = 'none';
    helpContainer.innerHTML = '';
    
    document.querySelectorAll('.help-highlight').forEach(element => {
        element.classList.remove('help-highlight');
    });
    
    helpElements = [];
}

// Handle window resize
function handleResize() {
    if (helpMode && helpElements.length > 0) {
        setTimeout(() => {
            showAllHelpMessages();
        }, 100);
    }
}

// Initialize when page loads
document.addEventListener('DOMContentLoaded', function() {
    helpButton.addEventListener('click', toggleHelpMode);
    helpOverlay.addEventListener('click', toggleHelpMode);
    window.addEventListener('resize', handleResize);
    
    window.addEventListener('scroll', () => {
        if (helpMode && helpElements.length > 0) {
            clearTimeout(window.scrollTimeout);
            window.scrollTimeout = setTimeout(() => {
                showAllHelpMessages();
            }, 50);
        }
    });
    
    document.addEventListener('click', function(e) {
        const helpElement = e.target.closest('[data-help]');
        if (helpMode && helpElement) {
            e.preventDefault();
            e.stopPropagation();
        }
    });
    
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && helpMode) {
            toggleHelpMode();
        }
    });
});

// Export functions for external use
window.HelpSystem = {
    toggleHelpMode,
    showAllHelpMessages,
    hideAllHelpMessages,
    isHelpMode: () => helpMode
};