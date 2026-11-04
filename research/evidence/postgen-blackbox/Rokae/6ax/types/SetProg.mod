MODULE MainModule
GLOBAL VAR robtarget robpoint0= p:{{-640.584, 506.980, 371.534},{0.408218, 0.234570, 0.875426, -0.109382}}{cfg 0,0,0,0}{EJ 0.000000000,0.000000000,0.000000000,0.000000000,0.000000000,0.000000000}
GLOBAL VAR robtarget robpoint1= p:{{-624.230, 571.208, 454.620},{0.552392, -0.042676, 0.673042, -0.489956}}{cfg 0,0,-2,1}{EJ 0.000000000,0.000000000,0.000000000,0.000000000,0.000000000,0.000000000}

GLOBAL Proc main()
    wobj16.x = 1234.57
    wobj16.y = -98.765
    wobj16.z = 50.500
    wobj16.q1 = 0.965926
    wobj16.q2 = 0.000000
    wobj16.q3 = 0.000000
    wobj16.q4 = 0.258819
    tool03.x = 10.000
    tool03.y = 20.000
    tool03.z = 150.000
    tool03.q1 = 1.000000
    tool03.q2 = 0.000000
    tool03.q3 = 0.000000
    tool03.q4 = 0.000000
    MoveJ robpoint0,v50,z50,tool03,wobj16
    Wait 0.250
    MoveJ robpoint1,v50,z50,tool03,wobj16
EndProc
EndModule
