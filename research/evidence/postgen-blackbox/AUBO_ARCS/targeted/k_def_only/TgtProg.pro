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
    </WaypointModel>
    <TimerModel/>
    <VariableModel>
    </VariableModel>
    <SubProgModel/>
    <InitVariablesNode title="初始变量" id="259f4329-e6f4-490b-9a16-4106cf6a659e">
        <datamodel/>
    </InitVariablesNode>
    <MainProgramNode title="机器人编程" id="12e0c8b2-bad6-40fb-9948-8dec4f65d4d9">
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
            <CallNode title="Call S" id="e443df78-9558-467f-9ba9-1faf7a024204">
                <datamodel>
                    <SubProgram key="subprog" name="S"/>
                </datamodel>
            </CallNode>
        </children>
    </MainProgramNode>
            <SubProgNode title="S" id="1846d424-c17c-4279-a3c6-612f48268673">
                <datamodel>
                    <String key="filePath" value="S.pro"/>
                    <Bool key="hasload" value="true"/>
                    <Bool key="keepUpdate" value="true"/>
                    <SubProgram key="subProg" name="S"/>
                </datamodel>
                <children>
        <WaitNode title="Wait: 0.25s" id="fcbd04c3-4021-4ef7-8ca5-a5a19e4d6e3c">
            <datamodel>
                <String key="compareOperator" value="LESS_THAN"/>
                <Bool key="di_value" value="false"/>
                <Expression key="expression"/>
                <Float32 key="floatValue" value="4"/>
                <Float64 key="timeout" value="0"/>
                <String key="type" value="TIME"/>
                <Float64 key="waitTime" value="0.25"/>
            </datamodel>
        </WaitNode>
            </children>
        </SubProgNode>

</AuboProgram>