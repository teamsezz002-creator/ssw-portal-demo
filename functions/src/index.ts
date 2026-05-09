import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();
const db = admin.firestore();

export const processTrackingEvent = functions.firestore
  .document('events/{eventId}')
  .onCreate(async (snap, context) => {
    const event = snap.data();
    if (!event) return;

    const {
      studentId,
      simulationId,
      sessionId,
      eventType,
      data,
      timestamp
    } = event;

    const metricRef = db.collection('user_metrics').doc(studentId);
    const sessionRef = db.collection('simulation_sessions').doc(sessionId);

    await db.runTransaction(async (transaction) => {
      // 1. Read existing
      const metricDoc = await transaction.get(metricRef);
      const sessionDoc = await transaction.get(sessionRef);

      const metric = metricDoc.exists ? metricDoc.data()! : {
        studentId,
        totalXP: 0,
        currentLevel: 1,
        totalTimeSpent: 0,
        totalCorrect: 0,
        totalAttempts: 0,
        totalTasksCompleted: 0,
        totalSimulationsCompleted: 0
      };

      const session = sessionDoc.exists ? sessionDoc.data()! : {
        sessionId,
        studentId,
        simulationId,
        startTime: timestamp, // Default to first event seen
        endTime: null,
        timeSpent: 0,
        xpEarned: 0,
        correctAnswers: 0,
        wrongAnswers: 0,
        attempts: 0,
        tasksCompleted: 0,
        hintsUsed: 0
      };

      // 2. Process logic based on eventType
      switch (eventType) {
        case 'SESSION_START':
          session.startTime = timestamp;
          break;

        case 'SESSION_END':
          session.endTime = timestamp;
          if (session.startTime) {
             const durationSecs = Math.max(0, Math.floor((timestamp - session.startTime) / 1000));
             session.timeSpent = durationSecs;
             metric.totalTimeSpent += durationSecs;
          }
          metric.totalSimulationsCompleted += 1;
          break;

        case 'HEARTBEAT':
          // Update end time progressively in case of crash (will be overwritten by SESSION_END if clean)
          session.endTime = timestamp;
          if (session.startTime) {
            session.timeSpent = Math.max(0, Math.floor((timestamp - session.startTime) / 1000));
          }
          break;

        case 'XP_EARNED':
          const earned = data?.xp || 0;
          metric.totalXP += earned;
          session.xpEarned += earned;
          break;

        case 'LEVEL_UP':
          metric.currentLevel += 1;
          break;

        case 'ANSWER_CORRECT':
          metric.totalCorrect += 1;
          metric.totalAttempts += 1;
          session.correctAnswers += 1;
          session.attempts += 1;
          break;

        case 'ANSWER_WRONG':
          metric.totalAttempts += 1;
          session.wrongAnswers += 1;
          session.attempts += 1;
          break;

        case 'QUESTION_ATTEMPT':
          metric.totalAttempts += 1;
          session.attempts += 1;
          break;

        case 'TASK_COMPLETED':
          metric.totalTasksCompleted += 1;
          session.tasksCompleted += 1;
          break;

        case 'HINT_USED':
          session.hintsUsed += 1;
          break;

        case 'SIMULATION_START':
        case 'SIMULATION_END':
          // Can be used for broader simulation analytics later
          break;
      }

      // 3. Write back
      transaction.set(metricRef, metric);
      transaction.set(sessionRef, session);
    });
  });
