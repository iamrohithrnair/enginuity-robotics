<?xml version="1.0" encoding="UTF-8"?>
<AuboProgram name="TgtProg" installation="TgtProg_ins" installationRelativePath="TgtProg_ins.ins" directory="/root/arcs_ws/program" createdIn="0.29.3-rc.10" lastSaveIn="0.29.3-rc.10" robotSerialNumber="RoboDK" crcValue="225635">
    <kinematics status="NOT_INITIALIZED" validChecksum="false">
        <theta value="3.14159265358979,-1.5707963267949,0,-1.5707963267949,0,0"/>
        <a value="0.0010004,0,0.647,0.601445091,0.000451803,-0.000785351"/>
        <d value="0.1632,0.201467966,-0.000167966,0.000167966,0.10373501,0.094884533"/>
        <alpha value="0,-1.5703531067949,3.13960138358979,3.13793245358979,-1.5694211267949,1.5774796767949"/>
        <jointChecksum value="0,0,0,0,0,0"/>
    </kinematics>
    <WaypointModel>
        <Waypoint name="Waypoint_0">
            <RobotPose pose="0, 0, 0, 0, 0, 0"/>
            <JointPositions angles="0.000000, -0.174533, 0.349066, 0.000000, 0.523599, 0.000000"/>
            <TcpOffset pose="0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000"/>
            <Kinematics status="NOT_INITIALIZED" validChecksum="false">
                <theta value="0,0,0,0,0,0"/>
                <a value="0,0,0,0,0,0"/>
                <d value="0,0,0,0,0,0"/>
                <alpha value="0,0,0,0,0,0"/>
                <beta value="0,0,0,0,0,0"/>
                <jointChecksum value="beta_value"/>
            </Kinematics>
        </Waypoint>
        <Waypoint name="Waypoint_1">
            <RobotPose pose="0, 0, 0, 0, 0, 0"/>
            <JointPositions angles="0.000000, -0.174533, 0.349066, 0.000000, 0.523599, 0.000000"/>
            <TcpOffset pose="0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000"/>
            <Kinematics status="NOT_INITIALIZED" validChecksum="false">
                <theta value="0,0,0,0,0,0"/>
                <a value="0,0,0,0,0,0"/>
                <d value="0,0,0,0,0,0"/>
                <alpha value="0,0,0,0,0,0"/>
                <beta value="0,0,0,0,0,0"/>
                <jointChecksum value="beta_value"/>
            </Kinematics>
        </Waypoint>
    </WaypointModel>
    <TimerModel/>
    <VariableModel>
    </VariableModel>
    <SubProgModel/>
    <InitVariablesNode title="初始变量" id="baf3897a-3e70-416a-9548-5822de1b372a">
        <datamodel/>
    </InitVariablesNode>
    <MainProgramNode title="机器人编程" id="101fbccc-ded7-43e8-b421-eaeb534097ca">
        <datamodel>
            <Bool key="addBeforeStartSequence" value="false"/>
            <Bool key="loopForever" value="true"/>
        </datamodel>
        <children>
            <ScriptNode title="Func_lib.lua" id="bc8a3b76-d231-4536-b144-2c91074bfc45">
                <datamodel>
                    <Expression key="expression"/>
                    <String key="file_path" value="Func_lib.lua"/>
                    <Bool key="use_file" value="true"/>
                </datamodel>
            </ScriptNode>
        <Halt/>
        <WaitNode title="Wait: 0.00s" id="23a7711a-8133-4876-b7eb-dcd9e87a1613">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="false"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="TIME"/>
                <Float64 key="waitTime" value="0.00"/>
            </datamodel>
        </WaitNode>
        <Halt/>
        <WaitNode title="Wait: 1.23s" id="259f4329-e6f4-490b-9a16-4106cf6a659e">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="false"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="TIME"/>
                <Float64 key="waitTime" value="1.23"/>
            </datamodel>
        </WaitNode>
        <MoveNode title="MoveJ" id="5a921187-19c7-4df4-8f4f-f31e78de5857">
            <datamodel>
                <Float64 key="blendRadius" value="0"/>
                <Feature key="feature" name="Base" id="a3f2c9bf-9c63-46b9-90f2-44556f25e2a2"/>
                <Float64 key="jointAcceleration" value="1.200"/>
                <Float64 key="jointSpeed" value="0.750"/>
                <Float64 key="toolAcceleration" value="1.2"/>
                <Float64 key="toolSpeed" value="0.25"/>
                <String key="type" value="MOVE_J"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="true"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_0" id="5487ce1e-af19-422a-99b8-a714e61a441c">
                    <datamodel>
                        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>
                        <Float64 key="blendRadius" value="0.02"/>
                        <String key="blendType" value="NO_BLEND"/>
                        <Float64 key="cartesianAcceleration" value="1.2"/>
                        <Float64 key="cartesianSpeed" value="0.25"/>
                        <Float64 key="jointAcceleration" value="1.200000"/>
                        <Float64 key="jointSpeed" value="0.750000"/>
                        <Float64 key="motionTime" value="0"/>
                        <String key="motionType" value="SHARED"/>
                        <String key="type" value="POSITION"/>
                        <String key="variableType" value="VARIABLE_POSE"/>
                        <Waypoint key="waypoint" name="Waypoint_0"/>
                    </datamodel>
                </WaypointNode>
            </children>
        </MoveNode>
        <ScriptNode title="code here" id="8d723104-f773-43c1-b458-a748e9bb17bc">
            <datamodel>
                <Expression key="expression">
                    <String string="c"/>
                    <String string="o"/>
                    <String string="d"/>
                    <String string="e"/>
                    <String string=" "/>
                    <String string="h"/>
                    <String string="e"/>
                    <String string="r"/>
                    <String string="e"/>
                </Expression>
                <Bool key="use_file" value="false"/>
            </datamodel>
        </ScriptNode>
            <CallNode title="Call fn" id="eb2083e6-ce16-4dba-8ff1-8e0242af9fc3">
                <datamodel>
                    <SubProgram key="subprog" name="fn"/>
                </datamodel>
            </CallNode>
        <MoveNode title="MoveJ" id="a0116be5-ab0c-4681-88f8-e3d0d3290a4c">
            <datamodel>
                <Float64 key="blendRadius" value="0.001000"/>
                <Feature key="feature" name="Base" id="d3fbf47a-7e5b-4e7f-9ca5-499d004ae545"/>
                <Float64 key="jointAcceleration" value="1.200"/>
                <Float64 key="jointSpeed" value="0.750"/>
                <Float64 key="toolAcceleration" value="1.2"/>
                <Float64 key="toolSpeed" value="0.25"/>
                <String key="type" value="MOVE_J"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="true"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_1" id="b5d32b16-6619-4cb1-9710-37d1b83e90ec">
                    <datamodel>
                        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>
                        <Float64 key="blendRadius" value="0.001000"/>
                        <String key="blendType" value="WAYPOINT_BLEND"/>
                        <Float64 key="cartesianAcceleration" value="1.2"/>
                        <Float64 key="cartesianSpeed" value="0.25"/>
                        <Float64 key="jointAcceleration" value="1.200000"/>
                        <Float64 key="jointSpeed" value="0.750000"/>
                        <Float64 key="motionTime" value="0"/>
                        <String key="motionType" value="SHARED"/>
                        <String key="type" value="POSITION"/>
                        <String key="variableType" value="VARIABLE_POSE"/>
                        <Waypoint key="waypoint" name="Waypoint_1"/>
                    </datamodel>
                </WaypointNode>
            </children>
        </MoveNode>
        </children>
    </MainProgramNode>

</AuboProgram>